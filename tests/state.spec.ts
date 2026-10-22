/**
 * Lifecycle state machine and login-failure detection: the two behaviors that
 * keep a dead credential from turning into a restart storm.
 * @module dsh-napcat-lifecycle/tests/state
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { detectLoginFailure, readOutput } from '../src/napcat.js'
import type { SpawnedProcess } from '../src/napcat.js'
import {
  emptyRestartState,
  loadRestartState,
  restartDecision,
  saveRestartState,
} from '../src/state.js'

const silentLog = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }

describe('detectLoginFailure', () => {
  it('matches every marker NapCat prints when the credential is gone', () => {
    expect(detectLoginFailure('14:26:41 [error] 快速登录错误： 登录态已失效，请重新登录。')).toBe('登录态已失效')
    expect(detectLoginFailure('将使用二维码登录方式')).toBe('将使用二维码登录方式')
    expect(detectLoginFailure('请扫描下面的二维码，然后在手Q上授权登录')).toBe('请扫描下面的二维码')
  })

  it('does not match a healthy startup log', () => {
    const healthy = '10-22 14:26:41 [info] 正在快速登录  1667006251\n10-22 14:26:41 [info] [OneBot] 适配器初始化完成'
    expect(detectLoginFailure(healthy)).toBeUndefined()
  })
})

describe('restartDecision', () => {
  it('refuses to restart while waiting for a human login', () => {
    expect(restartDecision('awaiting-login', 0, 3)).toEqual({ allowed: false, reason: 'login-required' })
  })

  it('refuses after an explicit stop', () => {
    expect(restartDecision('stopped', 0, 3)).toEqual({ allowed: false, reason: 'stopped' })
  })

  it('refuses once the persisted budget is spent', () => {
    expect(restartDecision('running', 3, 3)).toEqual({ allowed: false, reason: 'budget-exhausted' })
  })

  it('allows a crash restart while budget remains', () => {
    expect(restartDecision('running', 1, 3)).toEqual({ allowed: true, reason: 'crash' })
  })
})

describe('restart state persistence', () => {
  it('round-trips through the state file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'napcat-state-'))
    const path = join(dir, 'state.json')
    await saveRestartState(path, {
      restarts: 2,
      lastExit: { at: 123, exitCode: 1, signal: null, reason: 'running' },
      loginFailure: { at: 456, marker: '登录态已失效' },
    }, silentLog)
    const loaded = await loadRestartState(path)
    expect(loaded.restarts).toBe(2)
    expect(loaded.lastExit?.exitCode).toBe(1)
    expect(loaded.loginFailure?.marker).toBe('登录态已失效')
  })

  it('falls back to a fresh state for a missing or corrupt file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'napcat-state-'))
    expect(await loadRestartState(join(dir, 'missing.json'))).toEqual(emptyRestartState())
    const { writeFileSync } = await import('node:fs')
    const corrupt = join(dir, 'corrupt.json')
    writeFileSync(corrupt, '{not json')
    expect(await loadRestartState(corrupt)).toEqual(emptyRestartState())
  })

  it('keeps a restart budget across a simulated plugin reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'napcat-state-'))
    const path = join(dir, 'state.json')
    await saveRestartState(path, { restarts: 3 }, silentLog)
    // A fresh load (plugin reload) must see the spent budget, not zero.
    expect((await loadRestartState(path)).restarts).toBe(3)
    expect(restartDecision('running', (await loadRestartState(path)).restarts, 3).allowed).toBe(false)
  })
})

describe('readOutput', () => {
  it('returns the collected tail and degrades to empty without a reader', () => {
    const withReader: SpawnedProcess = {
      done: Promise.resolve({ exitCode: null, signal: null }),
      terminate: async () => undefined,
      waitForExit: async () => undefined,
      collected: { stdout: { readFrom: () => ({ text: 'hello', offset: 5 }) } },
    }
    expect(readOutput(withReader)).toBe('hello')
    const without: SpawnedProcess = {
      done: Promise.resolve({ exitCode: null, signal: null }),
      terminate: async () => undefined,
      waitForExit: async () => undefined,
    }
    expect(readOutput(without)).toBe('')
  })
})
