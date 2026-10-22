/**
 * dsh-napcat-lifecycle — bind the NapCat QQ/OneBot bridge to the host process
 * lifetime.
 *
 * The host's ctx.subprocess service owns the spawned process range: when the
 * service disposes (host shutdown, plugin reload) every descendant is
 * terminated and joined. That is stronger than an external watchdog, which
 * can only poll.
 *
 * Beyond the lifetime binding this plugin owns two things an external script
 * cannot:
 *
 * 1. Login-aware restarts. A process that exits because the QQ credential is
 *    gone is NOT restarted: only a human scanning the QR code can fix it, and
 *    a restart spawns a second QQ against the same profile, which invalidates
 *    the credential again. The state machine parks in awaiting-login instead.
 * 2. A status surface. ctx.napcatLifecycle exposes the live state, the recent
 *    log tail and start/stop/restart so the settings panel (client bundle) and
 *    any tool can read it without shelling out.
 * @module dsh-napcat-lifecycle
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  detectLoginFailure,
  missingFiles,
  readOutput,
  resolveLayout,
  startNapcat,
  stopNapcat,
  waitForPort,
} from './napcat.js'
import type { LoggerPort, SpawnedProcess, SubprocessPort } from './napcat.js'
import {
  loadRestartState,
  restartDecision,
  saveRestartState,
} from './state.js'
import type { LifecycleState, RestartState } from './state.js'

/** Runtime configuration. */
export interface Config {
  enabled: boolean
  napcatDir: string
  qqExe: string
  botQQ: string
  autoStart: boolean
  waitPort: number
  waitPortTimeoutMs: number
  gracefulShutdownMs: number
  restartOnExit: boolean
  maxRestarts: number
  restartDelayMs: number
  stdoutLogPath: string
  stdoutLogMaxBytes: number
  statePath: string
}

const DEFAULT_QQ = 'C:\\Program Files\\Tencent\\QQNT\\QQ.exe'
const DEFAULT_DSH_HOME = join(homedir(), '.dsh')

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true)
    .description('总开关：false 时插件挂载但不拉起任何进程'),
  napcatDir: z.string().required()
    .description('NapCat Shell 目录（含 NapCatWinBootMain.exe / NapCatWinBootHook.dll / qqnt.json / loadNapCat.js / napcat.mjs）'),
  qqExe: z.string().default('')
    .description('QQ.exe 绝对路径；留空时用 C:\\Program Files\\Tencent\\QQNT\\QQ.exe'),
  botQQ: z.string().required()
    .description('机器人 QQ 号（快速登录 -q 参数）'),
  autoStart: z.boolean().default(true)
    .description('插件加载时自动拉起 NapCat'),
  waitPort: z.number().step(1).min(0).default(8643)
    .description('拉起前等待该端口就绪（dsh-onebot 的反向 WS 端口）；0 = 不等待'),
  waitPortTimeoutMs: z.number().step(1).min(1000).default(30000)
    .description('等待端口就绪的超时（毫秒）；超时仍会拉起 NapCat 并记 warn'),
  gracefulShutdownMs: z.number().step(1).min(1000).default(5000)
    .description('关闭时交给 subprocess 服务的优雅终止宽限（毫秒）'),
  restartOnExit: z.boolean().default(true)
    .description('NapCat 异常退出时自动重启（登录失效不重启，见 awaiting-login）'),
  maxRestarts: z.number().step(1).min(0).default(3)
    .description('连续重启次数上限（持久化，插件重载不清零）；达到后放弃并记 error'),
  restartDelayMs: z.number().step(1).min(0).default(3000)
    .description('重启前等待（毫秒）'),
  stdoutLogPath: z.string().default('')
    .description('NapCat 完整 stdout 落盘路径；留空用 <DSH_HOME>/media/napcat/stdout.log'),
  stdoutLogMaxBytes: z.number().step(1).min(65536).default(8 * 1024 * 1024)
    .description('stdout 落盘上限（字节）'),
  statePath: z.string().default('')
    .description('重启计数持久化路径；留空用 <DSH_HOME>/media/napcat/state.json'),
})

/** One status snapshot for the panel and for tools. */
export interface LifecycleStatus {
  state: LifecycleState
  running: boolean
  botQQ: string
  startedAt: number | null
  restarts: number
  maxRestarts: number
  loginFailure: string | null
  lastExit: RestartState['lastExit'] | null
  webuiUrl: string
  recentLog: string
}

/** The service the client bundle and tools read. */
export interface LifecycleService {
  status(): LifecycleStatus
  start(): Promise<{ ok: boolean; message: string }>
  stop(): Promise<{ ok: boolean; message: string }>
  restart(): Promise<{ ok: boolean; message: string }>
}

/** The plugin name used in logs and effect labels. */
export const name = 'napcat-lifecycle'

/** Host services this plugin consumes. */
export const inject = ['subprocess']

/**
 * Read the NapCat WebUI URL (with its token) from its config.
 * @param layoutDir - NapCat Shell directory.
 * @returns the WebUI URL.
 */
async function readWebuiUrl(layoutDir: string): Promise<string> {
  try {
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(join(layoutDir, 'config', 'webui.json'), 'utf8')
    const parsed = JSON.parse(raw) as { port?: unknown; token?: unknown }
    const port = typeof parsed.port === 'number' ? parsed.port : 6099
    const token = typeof parsed.token === 'string' ? parsed.token : ''
    return 'http://127.0.0.1:' + String(port) + '/webui' + (token !== '' ? '?token=' + token : '')
  } catch {
    return 'http://127.0.0.1:6099/webui'
  }
}

/**
 * Mount the lifecycle plugin.
 * @param ctx - plugin context.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) {
    ctx.logger?.info?.('[napcat-lifecycle] disabled; nothing spawned')
    return
  }

  const maybeSubprocess = ctx.get('subprocess') as unknown as SubprocessPort | undefined
  if (maybeSubprocess === undefined) {
    ctx.logger?.error?.('[napcat-lifecycle] ctx.subprocess is not mounted; cannot manage the NapCat process')
    return
  }
  const subprocess: SubprocessPort = maybeSubprocess
  const log = ctx.logger as unknown as LoggerPort

  const layout = resolveLayout(config.napcatDir)
  const qqExe = config.qqExe !== '' ? config.qqExe : DEFAULT_QQ
  const dshHome = process.env.DSH_HOME ?? DEFAULT_DSH_HOME
  const statePath = config.statePath !== '' ? config.statePath : join(dshHome, 'media', 'napcat', 'state.json')
  const stdoutLogPath = config.stdoutLogPath !== '' ? config.stdoutLogPath : join(dshHome, 'media', 'napcat', 'stdout.log')

  let handle: SpawnedProcess | undefined
  let lifecycle: LifecycleState = 'stopped'
  let startedAt: number | null = null
  let restarts = 0
  let stopping = false
  let restartTimer: NodeJS.Timeout | undefined
  let lastExit: RestartState['lastExit'] | null = null
  let loginFailure: string | null = null
  let webuiUrl = 'http://127.0.0.1:6099/webui'

  /** Persist the restart bookkeeping (best-effort). */
  const persist = (): void => {
    void saveRestartState(statePath, {
      restarts,
      ...(lastExit === null ? {} : { lastExit }),
      ...(loginFailure === null ? {} : { loginFailure: { at: Date.now(), marker: loginFailure } }),
    }, log)
  }

  /** Whether an injected NapCat already runs (single-instance guard). */
  async function findExistingNapcat(): Promise<number | undefined> {
    try {
      const { execFile } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const run = promisify(execFile)
      const { stdout } = await run('tasklist', ['/FI', 'IMAGENAME eq NapCatWinBootMain.exe', '/FO', 'CSV', '/NH'])
      const match = /NapCatWinBootMain\.exe","(\d+)"/.exec(stdout)
      return match === null ? undefined : Number(match[1])
    } catch {
      return undefined
    }
  }

  /** Spawn once. */
  async function launch(): Promise<void> {
    if (stopping) return
    const missing = await missingFiles(layout)
    if (missing.length > 0) {
      log.error('[napcat-lifecycle] NapCat layout incomplete, missing: ' + missing.join(', '))
      lifecycle = 'stopped'
      return
    }
    const existing = await findExistingNapcat()
    if (existing !== undefined) {
      log.warn('[napcat-lifecycle] an injected NapCat is already running (pid ' + String(existing) + '); not spawning a second instance')
      lifecycle = 'running'
      if (startedAt === null) startedAt = Date.now()
      return
    }
    if (config.waitPort > 0) {
      const ready = await waitForPort(config.waitPort, config.waitPortTimeoutMs)
      if (!ready) {
        log.warn('[napcat-lifecycle] port ' + config.waitPort + ' not ready after ' + config.waitPortTimeoutMs + 'ms; spawning anyway')
      }
    }
    lifecycle = 'starting'
    try {
      handle = startNapcat({
        subprocess,
        log,
        layout,
        qqExe,
        botQQ: config.botQQ,
        graceMs: config.gracefulShutdownMs,
        stdoutSpillPath: stdoutLogPath,
        stdoutSpillMaxBytes: config.stdoutLogMaxBytes,
      })
    } catch (error) {
      log.error('[napcat-lifecycle] spawn failed: ' + String(error))
      lifecycle = 'stopped'
      return
    }
    startedAt = Date.now()
    lifecycle = 'running'
    webuiUrl = await readWebuiUrl(layout.dir)
    log.info('[napcat-lifecycle] NapCat started (pid range owned by the host subprocess service); webui=' + webuiUrl)
    watchExit()
    void watchLogin()
  }

  /** Poll the collected stdout for login-failure markers. */
  async function watchLogin(): Promise<void> {
    const current = handle
    if (current === undefined) return
    for (let i = 0; i < 60; i += 1) {
      if (stopping || handle !== current) return
      await new Promise(resolve => setTimeout(resolve, 1000))
      const marker = detectLoginFailure(readOutput(current))
      if (marker !== undefined) {
        lifecycle = 'awaiting-login'
        loginFailure = marker
        restarts = 0
        persist()
        log.warn('[napcat-lifecycle] login required (' + marker + '); parked in awaiting-login — scan the QR code, no automatic restart')
        return
      }
    }
  }

  /** Resolve when the process exits; restart only when the state allows it. */
  function watchExit(): void {
    const current = handle
    if (current === undefined) return
    void current.done.then(
      outcome => {
        if (stopping || handle !== current) return
        handle = undefined
        lastExit = { at: Date.now(), exitCode: outcome.exitCode, signal: outcome.signal, reason: lifecycle }
        persist()
        const decision = restartDecision(lifecycle, restarts, config.maxRestarts)
        if (!config.restartOnExit || !decision.allowed) {
          log.warn('[napcat-lifecycle] NapCat exited (code=' + String(outcome.exitCode) + '); no restart: ' + decision.reason)
          if (lifecycle !== 'awaiting-login') lifecycle = 'stopped'
          return
        }
        restarts += 1
        lifecycle = 'starting'
        persist()
        log.info('[napcat-lifecycle] restart ' + restarts + '/' + config.maxRestarts + ' in ' + config.restartDelayMs + 'ms')
        restartTimer = setTimeout(() => { void launch() }, config.restartDelayMs)
      },
      error => {
        if (stopping) return
        log.error('[napcat-lifecycle] process failed: ' + String(error))
      },
    )
  }

  /** Stop the current process (also used by the service). */
  async function shutdown(): Promise<void> {
    if (restartTimer !== undefined) clearTimeout(restartTimer)
    const current = handle
    handle = undefined
    await stopNapcat(current, log)
    lifecycle = 'stopped'
  }

  /** The status snapshot. */
  function status(): LifecycleStatus {
    return {
      state: lifecycle,
      running: handle !== undefined,
      botQQ: config.botQQ,
      startedAt,
      restarts,
      maxRestarts: config.maxRestarts,
      loginFailure,
      lastExit,
      webuiUrl,
      recentLog: handle === undefined ? '' : readOutput(handle).slice(-4000),
    }
  }

  const service: LifecycleService = {
    status,
    async start() {
      if (handle !== undefined) return { ok: false, message: 'NapCat 已在运行' }
      stopping = false
      restarts = 0
      loginFailure = null
      lifecycle = 'stopped'
      await launch()
      return { ok: handle !== undefined, message: handle !== undefined ? '已启动' : '启动失败，见日志' }
    },
    async stop() {
      await shutdown()
      return { ok: true, message: '已停止' }
    },
    async restart() {
      await shutdown()
      stopping = false
      restarts = 0
      loginFailure = null
      await new Promise(resolve => setTimeout(resolve, 1000))
      await launch()
      return { ok: handle !== undefined, message: handle !== undefined ? '已重启' : '重启失败，见日志' }
    },
  }

  // Expose the service so the client bundle and tools can read the live state.
  ctx.provide('napcatLifecycle', service)

  ctx.effect(() => {
    void loadRestartState(statePath).then(stored => {
      restarts = stored.restarts
      lastExit = stored.lastExit ?? null
      loginFailure = stored.loginFailure?.marker ?? null
      if (stored.loginFailure !== undefined) lifecycle = 'awaiting-login'
    }).then(() => {
      if (config.autoStart && lifecycle !== 'awaiting-login') void launch()
      else if (lifecycle === 'awaiting-login') log.warn('[napcat-lifecycle] previous run needed a login; waiting for the QR scan instead of auto-starting')
    })
    return async () => {
      stopping = true
      await shutdown()
    }
  }, 'napcat-lifecycle')
}
