/**
 * napcatLifecycle Remote contract: the client reaches the host through this
 * namespace (a browser bundle cannot see host cordis services), so the patch
 * validation, revision semantics and config snapshot must be pinned.
 * @module dsh-napcat-lifecycle/tests/settings-remote
 */
import { describe, expect, it } from 'vitest'

import {
  CONFIG_KEYS,
  createRevisionState,
  getConfig,
  observeRevision,
  updateConfig,
  validatePatch,
} from '../src/settings-remote.js'

interface FakeEntry {
  options: { id?: string; config?: Record<string, unknown> }
  fiber?: { state?: number }
}

/** A config editor over one in-memory entry. */
function makeEditor(initial: Record<string, unknown> = {}, active = true) {
  const entry: FakeEntry = { options: { id: 'napcat-lifecycle', config: { ...initial } }, fiber: { state: active ? 2 : 1 } }
  const edits: Array<Record<string, unknown>> = []
  return {
    entry,
    edits,
    editor: {
      entries: () => [entry],
      async edit(target: FakeEntry, merge: (fresh: Record<string, unknown>) => Record<string, unknown>) {
        const next = merge(target.options.config ?? {})
        target.options.config = next
        edits.push(next)
      },
    },
  }
}

describe('validatePatch', () => {
  it('keeps only known keys', () => {
    expect(validatePatch({ botQQ: '42', bogus: 'x' })).toEqual({ botQQ: '42' })
  })

  it('rejects non-object payloads', () => {
    expect(() => validatePatch(null)).toThrow(/plain object/)
    expect(() => validatePatch([])).toThrow(/plain object/)
    expect(() => validatePatch('x')).toThrow(/plain object/)
  })

  it('rejects nested values', () => {
    expect(() => validatePatch({ botQQ: { nested: true } })).toThrow(/unsupported value type/)
  })

  it('drops null/undefined so they do not erase stored values', () => {
    expect(validatePatch({ botQQ: null, waitPort: undefined, maxRestarts: 5 })).toEqual({ maxRestarts: 5 })
  })
})

describe('revision semantics', () => {
  it('bumps only when the fingerprint changes', () => {
    const state = createRevisionState()
    expect(observeRevision(state, { a: 1 })).toBe(0)   // baseline
    expect(observeRevision(state, { a: 1 })).toBe(0)   // unchanged
    expect(observeRevision(state, { a: 2 })).toBe(1)   // changed
    expect(observeRevision(state, { a: 2 })).toBe(1)
  })
})

describe('getConfig', () => {
  it('returns the stored config plus the key list and entry activity', () => {
    const { editor } = makeEditor({ botQQ: '1667006251', waitPort: 8643 })
    const snapshot = getConfig(editor, createRevisionState())
    expect(snapshot.config).toMatchObject({ botQQ: '1667006251', waitPort: 8643 })
    expect(snapshot.keys).toEqual(CONFIG_KEYS)
    expect(snapshot.entryActive).toBe(true)
  })

  it('reports an inactive entry', () => {
    const { editor } = makeEditor({}, false)
    expect(getConfig(editor, createRevisionState()).entryActive).toBe(false)
  })

  it('fails with an actionable error when the entry is missing', () => {
    const editor = { entries: () => [], edit: async () => undefined }
    expect(() => getConfig(editor, createRevisionState())).toThrow(/napcat-lifecycle/)
  })
})

describe('updateConfig', () => {
  it('merges a patch and returns the new snapshot', async () => {
    const { editor, edits } = makeEditor({ botQQ: '42', maxRestarts: 3 })
    const state = createRevisionState()
    const snapshot = await updateConfig(editor, state, { maxRestarts: 5 })
    expect(edits).toHaveLength(1)
    expect(snapshot.config).toMatchObject({ botQQ: '42', maxRestarts: 5 })
  })

  it('refuses a stale expectedRevision', async () => {
    const { editor, edits } = makeEditor({ botQQ: '42' })
    const state = createRevisionState()
    getConfig(editor, state)                       // baseline revision 0
    await updateConfig(editor, state, { maxRestarts: 5 })  // revision -> 1
    await expect(updateConfig(editor, state, { maxRestarts: 6 }, 0)).rejects.toThrow(/does not match/)
    expect(edits).toHaveLength(1)
  })

  it('short-circuits a no-op patch without writing', async () => {
    const { editor, edits } = makeEditor({ botQQ: '42' })
    const state = createRevisionState()
    getConfig(editor, state)
    await updateConfig(editor, state, { botQQ: '42' })
    expect(edits).toHaveLength(0)
  })

  it('translates a host edit failure into an actionable message', async () => {
    const entry: FakeEntry = { options: { id: 'napcat-lifecycle', config: {} }, fiber: { state: 2 } }
    const editor = {
      entries: () => [entry],
      edit: async () => { throw new Error('timed out waiting for the writer lock') },
    }
    await expect(updateConfig(editor, createRevisionState(), { botQQ: '1' }))
      .rejects.toThrow(/写入失败/)
  })
})
