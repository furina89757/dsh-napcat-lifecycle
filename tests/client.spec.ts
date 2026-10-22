/**
 * Client bundle contract: the CJS wrapper loads through the platform module
 * loader, exposes inject/apply, and registers exactly one Settings section
 * with the expected id/order plus the locale dictionary.
 * @module dsh-napcat-lifecycle/tests/client
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const BUNDLE = readFileSync(join(import.meta.dirname, '..', 'client', 'index.js'), 'utf8')

interface LoaderSpec { id: string; factory: (require: (name: string) => unknown) => Record<string, unknown> }

/** Load the bundle in a fake ModuleLoader environment. */
function loadBundle() {
  let spec: LoaderSpec | undefined
  const fakeWindow = {
    __ModuleLoader__: {
      load(next: LoaderSpec) { spec = next },
    },
  }
  const fakeReact = {
    createElement: () => ({ type: 'div', props: {}, children: [] }),
    useState: (init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, () => undefined],
    useEffect: () => undefined,
    useCallback: (fn: unknown) => fn,
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('window', 'require', 'document', BUNDLE) as (
    w: unknown, r: (name: string) => unknown, d: unknown,
  ) => void
  const fakeDocument = {
    createElement: () => ({ dataset: {} as Record<string, string>, textContent: '', remove: () => undefined }),
    head: { appendChild: () => undefined },
  }
  run(fakeWindow, (name: string) => {
    if (name === 'react') return fakeReact
    throw new Error('unexpected require: ' + name)
  }, fakeDocument)
  if (spec === undefined) throw new Error('ModuleLoader.load was not called')
  return { spec, exports: spec.factory((name: string) => {
    if (name === 'react') return fakeReact
    throw new Error('unexpected require: ' + name)
  }) }
}

describe('client bundle', () => {
  it('loads through the platform module loader with the plugin id', () => {
    const { spec } = loadBundle()
    expect(spec.id).toBe('dsh-napcat-lifecycle')
  })

  it('exports inject/apply and the panel components', () => {
    const { exports } = loadBundle()
    expect(exports.inject).toEqual(['slots', 'locale'])
    expect(typeof exports.apply).toBe('function')
    expect(typeof exports.NapcatPanel).toBe('function')
    expect(typeof exports.WebuiModal).toBe('function')
  })

  it('registers exactly one settings.section with id napcat and order 30', async () => {
    const { exports } = loadBundle()
    const registrations: Array<{ def: Record<string, unknown>; component: unknown }> = []
    const dictionaries: string[] = []
    const ctx = {
      effect: (fn: () => unknown) => { fn(); return () => undefined },
      locale: {
        register: (ns: string) => { dictionaries.push(ns); return () => undefined },
        bind: () => (key: string) => key,
      },
      slots: {
        inject: (name: string, cb: () => unknown) => { expect(name).toBe('settings.section'); cb() },
        register: (def: Record<string, unknown>, component: unknown) => {
          registrations.push({ def, component })
          return () => undefined
        },
      },
      get: () => undefined,
    }
    await (exports.apply as (c: unknown) => Promise<void>)(ctx)
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.def.name).toBe('settings.section')
    expect(registrations[0]?.def.id).toBe('napcat')
    expect(registrations[0]?.def.order).toBe(30)
    expect(typeof registrations[0]?.component).toBe('function')
    expect(dictionaries).toEqual(['napcatLifecycle'])
  })

  it('carries zh and en dictionaries with the same key set', () => {
    const { exports } = loadBundle()
    const zh = exports.zh as Record<string, string>
    const en = exports.en as Record<string, string>
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    expect(zh.nav).toBe('NapCat')
  })
})
