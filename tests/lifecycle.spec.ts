/**
 * Unit tests for the lifecycle plugin: layout/env resolution, the spawn
 * request shape (the five NAPCAT_* variables must ride along — the Shell
 * launcher sets them and the boot exe reads them), the port wait, and the
 * start/stop pair driven through a fake subprocess service.
 * @module dsh-napcat-lifecycle/tests
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  buildEnv,
  missingFiles,
  resolveLayout,
  startNapcat,
  stopNapcat,
  waitForPort,
} from '../src/napcat.js'
import type { SpawnedProcess, SubprocessPort } from '../src/napcat.js'

/** A fake NapCat install directory with every file the launcher needs. */
function makeLayoutDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'napcat-layout-'))
  for (const file of ['NapCatWinBootMain.exe', 'NapCatWinBootHook.dll', 'qqnt.json', 'loadNapCat.js', 'napcat.mjs']) {
    writeFileSync(join(dir, file), 'x')
  }
  return dir
}

/** A fake subprocess service recording spawn requests. */
function makeSubprocess(overrides: { exitCode?: number | null } = {}) {
  const spawned: Array<Record<string, unknown>> = []
  const terminated: string[] = []
  const subprocess: SubprocessPort = {
    resolveExecutable: vi.fn(async (name: string) => 'C:/fake/' + name),
    spawn: vi.fn(request => {
      spawned.push(request as unknown as Record<string, unknown>)
      const handle: SpawnedProcess = {
        done: Promise.resolve({ exitCode: overrides.exitCode ?? null, signal: null }),
        terminate: vi.fn(async () => { terminated.push('terminate') }),
        waitForExit: vi.fn(async () => { terminated.push('waitForExit') }),
      }
      return handle
    }),
  }
  return { subprocess, spawned, terminated }
}

const silentLog = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }

describe('layout resolution', () => {
  it('resolves every file the Shell launcher needs', () => {
    const layout = resolveLayout('C:/napcat')
    expect(layout.bootExe).toBe(join('C:/napcat', 'NapCatWinBootMain.exe'))
    expect(layout.hookDll).toBe(join('C:/napcat', 'NapCatWinBootHook.dll'))
    expect(layout.patchPackage).toBe(join('C:/napcat', 'qqnt.json'))
    expect(layout.loadPath).toBe(join('C:/napcat', 'loadNapCat.js'))
    expect(layout.mainPath).toBe(join('C:/napcat', 'napcat.mjs'))
  })

  it('builds the five NAPCAT_* variables verbatim', () => {
    const env = buildEnv(resolveLayout('C:/napcat'))
    expect(Object.keys(env).sort()).toEqual([
      'NAPCAT_INJECT_PATH', 'NAPCAT_LAUNCHER_PATH', 'NAPCAT_LOAD_PATH',
      'NAPCAT_MAIN_PATH', 'NAPCAT_PATCH_PACKAGE',
    ])
    expect(env.NAPCAT_PATCH_PACKAGE).toBe(join('C:/napcat', 'qqnt.json'))
  })

  it('reports missing files instead of throwing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'napcat-empty-'))
    mkdirSync(join(dir, 'sub'))
    const missing = await missingFiles(resolveLayout(dir))
    expect(missing.length).toBe(5)
  })

  it('reports nothing missing for a complete install', async () => {
    const missing = await missingFiles(resolveLayout(makeLayoutDir()))
    expect(missing).toEqual([])
  })
})

describe('startNapcat', () => {
  it('spawns the boot exe with the QQ path, hook dll and quick-login flag', () => {
    const dir = makeLayoutDir()
    const layout = resolveLayout(dir)
    const { subprocess, spawned } = makeSubprocess()
    startNapcat({
      subprocess, log: silentLog, layout,
      qqExe: 'C:/QQ/QQ.exe', botQQ: '1667006251', graceMs: 5000,
    })
    expect(spawned).toHaveLength(1)
    const argv = spawned[0]?.argv as string[]
    expect(argv[0]).toBe(layout.bootExe)
    expect(argv[1]).toBe('C:/QQ/QQ.exe')
    expect(argv[2]).toBe(layout.hookDll)
    expect(argv.slice(3)).toEqual(['-q', '1667006251'])
  })

  it('passes cwd, grace and the launcher environment through', () => {
    const dir = makeLayoutDir()
    const layout = resolveLayout(dir)
    const { subprocess, spawned } = makeSubprocess()
    startNapcat({
      subprocess, log: silentLog, layout,
      qqExe: 'C:/QQ/QQ.exe', botQQ: '42', graceMs: 7000,
    })
    const request = spawned[0] as Record<string, unknown>
    expect(request.cwd).toBe(dir)
    expect(request.graceMs).toBe(7000)
    const env = request.env as Record<string, string>
    expect(env.NAPCAT_MAIN_PATH).toBe(layout.mainPath)
    expect(env.NAPCAT_INJECT_PATH).toBe(layout.hookDll)
  })
})

describe('stopNapcat', () => {
  it('terminates then waits for the managed range to settle', async () => {
    const { subprocess, terminated } = makeSubprocess()
    const handle = startNapcat({
      subprocess, log: silentLog, layout: resolveLayout(makeLayoutDir()),
      qqExe: 'C:/QQ/QQ.exe', botQQ: '42', graceMs: 1000,
    })
    await stopNapcat(handle, silentLog)
    expect(terminated).toEqual(['terminate', 'waitForExit'])
  })

  it('is a no-op without a handle', async () => {
    await expect(stopNapcat(undefined, silentLog)).resolves.toBeUndefined()
  })

  it('swallows terminate failures so shutdown always completes', async () => {
    const failing: SpawnedProcess = {
      done: Promise.resolve({ exitCode: null, signal: null }),
      terminate: async () => { throw new Error('boom') },
      waitForExit: async () => undefined,
    }
    await expect(stopNapcat(failing, silentLog)).resolves.toBeUndefined()
  })
})

describe('waitForPort', () => {
  it('returns false for a closed port within the timeout', async () => {
    const started = Date.now()
    const open = await waitForPort(1, 600, 100)
    expect(open).toBe(false)
    expect(Date.now() - started).toBeLessThan(3000)
  })
})
