/**
 * dsh-napcat-lifecycle — bind the NapCat QQ/OneBot bridge to the host process
 * lifetime.
 *
 * The host's `ctx.subprocess` service owns the spawned process range: when the
 * service disposes (host shutdown, plugin reload) every descendant is
 * terminated and joined. That is stronger than an external watchdog, which
 * can only poll. The plugin also waits for the OneBot reverse-WS port to open
 * before spawning, so NapCat's first dial-in lands on a listening socket.
 * @module dsh-napcat-lifecycle
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

import {
  missingFiles,
  resolveLayout,
  startNapcat,
  stopNapcat,
  waitForPort,
} from './napcat.js'
import type { LoggerPort, SpawnedProcess, SubprocessPort } from './napcat.js'

/** Runtime configuration. */
export interface Config {
  /** Master switch; false mounts the plugin idle. */
  enabled: boolean
  /** NapCat Shell directory (holds NapCatWinBootMain.exe). */
  napcatDir: string
  /** QQ.exe absolute path; empty = resolve from the well-known install path. */
  qqExe: string
  /** Bot QQ number for quick login. */
  botQQ: string
  /** Spawn NapCat when the plugin loads. */
  autoStart: boolean
  /** OneBot reverse-WS port to wait for before spawning (0 = do not wait). */
  waitPort: number
  /** How long to wait for that port. */
  waitPortTimeoutMs: number
  /** Grace period handed to the subprocess service on terminate. */
  gracefulShutdownMs: number
  /** Restart NapCat when it exits unexpectedly. */
  restartOnExit: boolean
  /** Cap on consecutive restarts before giving up. */
  maxRestarts: number
  /** Delay before a restart attempt. */
  restartDelayMs: number
}

const DEFAULT_QQ = 'C:\\Program Files\\Tencent\\QQNT\\QQ.exe'

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
    .description('NapCat 意外退出时自动重启'),
  maxRestarts: z.number().step(1).min(0).default(3)
    .description('连续重启次数上限；达到后放弃并记 error'),
  restartDelayMs: z.number().step(1).min(0).default(3000)
    .description('重启前等待（毫秒）'),
})

/** The plugin name used in logs and effect labels. */
export const name = 'napcat-lifecycle'

/** Host services this plugin consumes. */
export const inject = ['subprocess']

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
  // Bind the narrowed value: closures below outlive this scope, so the
  // guard's narrowing would otherwise be lost inside them.
  const subprocess: SubprocessPort = maybeSubprocess

  const log = ctx.logger as unknown as LoggerPort
  const layout = resolveLayout(config.napcatDir)
  const qqExe = config.qqExe !== '' ? config.qqExe : DEFAULT_QQ

  let handle: SpawnedProcess | undefined
  let restarts = 0
  let stopping = false
  let restartTimer: NodeJS.Timeout | undefined

  /** Spawn once, then arm the exit watcher. */
  async function launch(): Promise<void> {
    if (stopping) return
    const missing = await missingFiles(layout)
    if (missing.length > 0) {
      log.error('[napcat-lifecycle] NapCat layout incomplete, missing: ' + missing.join(', '))
      return
    }
    if (config.waitPort > 0) {
      const ready = await waitForPort(config.waitPort, config.waitPortTimeoutMs)
      if (!ready) {
        log.warn('[napcat-lifecycle] port ' + config.waitPort + ' not ready after ' + config.waitPortTimeoutMs + 'ms; spawning anyway')
      }
    }
    try {
      handle = startNapcat({
        subprocess,
        log,
        layout,
        qqExe,
        botQQ: config.botQQ,
        graceMs: config.gracefulShutdownMs,
      })
    } catch (error) {
      log.error('[napcat-lifecycle] spawn failed: ' + String(error))
      return
    }
    log.info('[napcat-lifecycle] NapCat started (pid range owned by the host subprocess service)')
    watchExit()
  }

  /** Resolve when the process exits; restart or give up. */
  function watchExit(): void {
    const current = handle
    if (current === undefined) return
    void current.done.then(
      outcome => {
        if (stopping || handle !== current) return
        handle = undefined
        log.warn('[napcat-lifecycle] NapCat exited (code=' + String(outcome.exitCode) + '); restartOnExit=' + String(config.restartOnExit))
        if (!config.restartOnExit) return
        if (restarts >= config.maxRestarts) {
          log.error('[napcat-lifecycle] giving up after ' + restarts + ' restarts')
          return
        }
        restarts += 1
        log.info('[napcat-lifecycle] restart ' + restarts + '/' + config.maxRestarts + ' in ' + config.restartDelayMs + 'ms')
        restartTimer = setTimeout(() => { void launch() }, config.restartDelayMs)
      },
      error => {
        if (stopping) return
        log.error('[napcat-lifecycle] process failed: ' + String(error))
      },
    )
  }

  ctx.effect(() => {
    if (config.autoStart) void launch()
    return async () => {
      stopping = true
      if (restartTimer !== undefined) clearTimeout(restartTimer)
      await stopNapcat(handle, log)
      handle = undefined
    }
  }, 'napcat-lifecycle')
}
