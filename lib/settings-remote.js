/**
 * dsh-napcat-lifecycle — napcatLifecycle Typert Remote service (host plane).
 *
 * The Settings panel runs in the BROWSER: it cannot reach a host cordis service
 * through ctx.get(). The only supported channel is a Typert Remote namespace,
 * which the client mounts and then calls as `remote.napcatLifecycle.*`.
 *
 * This module is mounted as its own loader row (see cordis.patch.yml:
 * `napcat-lifecycle-remote` → `dsh-napcat-lifecycle/settings-remote`) so the
 * api-gateway discovers the namespace independently of the main plugin row.
 *
 * Contract (all positional — the host gateway rejects destructuring, defaults
 * and rest in methodParameterNames):
 *
 *   getStatus()                → LifecycleStatusSnapshot
 *   start()                    → ActionResult
 *   stop()                     → ActionResult
 *   restart()                  → ActionResult
 *   getConfig()                → ConfigSnapshot
 *   updateConfig(patch, rev)   → ConfigSnapshot
 *
 * Config persistence = the profile patch config row of the `napcat-lifecycle`
 * entry, written through the host's configEditor (file lock + atomic write +
 * reconcile + rollback on activation failure). No second write path.
 *
 * When @deepseek-ai/dsh-typert-protocol cannot be resolved (bare dev checkout)
 * the service degrades to a plain cordis service with the same method surface —
 * the plugin still loads, only gateway discovery is lost.
 */
import { isDeepStrictEqual } from 'node:util';
/** patch insert id of the main plugin entry (the config override target). */
export const ENTRY_ID = 'napcat-lifecycle';
/** Remote namespace = cordis service key on the host. */
export const NAMESPACE = 'napcatLifecycle';
/** Config fields the panel may edit. */
export const CONFIG_KEYS = [
    'enabled',
    'napcatDir',
    'qqExe',
    'botQQ',
    'autoStart',
    'waitPort',
    'waitPortTimeoutMs',
    'gracefulShutdownMs',
    'restartOnExit',
    'maxRestarts',
    'restartDelayMs',
];
class FallbackRemoteError extends Error {
    code;
    details;
    isDSHRemoteError = true;
    constructor(code, message, details, options) {
        super(message, options);
        this.code = code;
        this.details = details;
        this.name = 'RemoteError';
    }
}
let protocol = null;
try {
    protocol = await import('@deepseek-ai/dsh-typert-protocol');
}
catch {
    protocol = null;
}
const RemoteError = (protocol?.RemoteError ?? FallbackRemoteError);
/** Resolve the host config editor or fail with an actionable error. */
function requireConfigEditor(ctx) {
    const editor = ctx?.get?.('configEditor');
    if (!editor || typeof editor.entries !== 'function' || typeof editor.edit !== 'function') {
        throw new RemoteError('napcat-lifecycle/no-config-editor', 'configEditor service is unavailable: the napcat-lifecycle-remote row must mount beside the host dsh-config-editor', { entryId: ENTRY_ID });
    }
    return editor;
}
/** Locate the napcat-lifecycle entry in the profile patch. */
function findEntry(editor) {
    const entry = editor.entries().find(candidate => candidate?.options?.id === ENTRY_ID);
    if (!entry) {
        throw new RemoteError('napcat-lifecycle/no-entry', 'no active "' + ENTRY_ID + '" entry in the profile patch — mount dsh-napcat-lifecycle first', { entryId: ENTRY_ID });
    }
    return entry;
}
/** fiber.state === 2 = active (same predicate the config editor uses). */
function entryActiveOf(entry) {
    return entry.fiber !== undefined && entry.fiber.state === 2;
}
export function createRevisionState() {
    return { revision: 0, fingerprint: null };
}
function fingerprintOf(config) {
    return JSON.stringify(config ?? null);
}
/** Observe a committed change from ANY source and bump the revision. */
export function observeRevision(state, config) {
    const fingerprint = fingerprintOf(config);
    if (state.fingerprint !== null && fingerprint !== state.fingerprint)
        state.revision += 1;
    state.fingerprint = fingerprint;
    return state.revision;
}
/** Validate an incoming config patch: known keys only, primitive/array values. */
export function validatePatch(patch) {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new RemoteError('napcat-lifecycle/bad-patch', 'config patch must be a plain object', {});
    }
    const out = {};
    for (const [key, value] of Object.entries(patch)) {
        if (!CONFIG_KEYS.includes(key))
            continue;
        if (value === null || value === undefined)
            continue;
        const kind = typeof value;
        if (kind !== 'string' && kind !== 'number' && kind !== 'boolean') {
            throw new RemoteError('napcat-lifecycle/bad-patch', 'unsupported value type for ' + key, { key });
        }
        out[key] = value;
    }
    return out;
}
/** Build the config snapshot from a live entry. */
export function buildConfigSnapshot(entry, state) {
    const config = entry.options.config ?? {};
    return {
        revision: observeRevision(state, config),
        entryActive: entryActiveOf(entry),
        config,
        keys: CONFIG_KEYS,
    };
}
/** getConfig implementation. */
export function getConfig(editor, state) {
    return buildConfigSnapshot(findEntry(editor), state);
}
/** updateConfig implementation (positional: patch, expectedRevision). */
export async function updateConfig(editor, state, patch, expectedRevision) {
    const entry = findEntry(editor);
    const actual = observeRevision(state, entry.options.config ?? {});
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision !== actual)) {
        throw new RemoteError('napcat-lifecycle/conflict', 'expectedRevision ' + String(expectedRevision) + ' does not match current revision ' + actual, { expected: expectedRevision, actual });
    }
    const clean = validatePatch(patch);
    const current = entry.options.config ?? {};
    const merged = { ...current, ...clean };
    if (isDeepStrictEqual(merged, current))
        return buildConfigSnapshot(entry, state);
    try {
        await editor.edit(entry, fresh => ({ ...fresh, ...clean }));
    }
    catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new RemoteError('napcat-lifecycle/edit-failed', '写入失败：宿主 configEditor 拒绝了本次修改（' + message + '），配置保持不变', { hostMessage: message }, { cause });
    }
    return buildConfigSnapshot(findEntry(editor), state);
}
/** The lifecycle service the main plugin row provides (resolved lazily). */
function resolveLifecycle(ctx) {
    const service = ctx?.get?.(NAMESPACE);
    if (service === undefined || typeof service.status !== 'function') {
        throw new RemoteError('napcat-lifecycle/no-service', 'the napcatLifecycle host service is not mounted — the main napcat-lifecycle plugin row is missing or disabled', {});
    }
    return service;
}
/** Method surface shared by the typert and plain branches. */
export function createMethods(ctx, state = createRevisionState()) {
    return {
        getStatus: async () => resolveLifecycle(ctx).status(),
        start: async () => resolveLifecycle(ctx).start(),
        stop: async () => resolveLifecycle(ctx).stop(),
        restart: async () => resolveLifecycle(ctx).restart(),
        getConfig: async () => getConfig(requireConfigEditor(ctx), state),
        updateConfig: async (patch, expectedRevision) => updateConfig(requireConfigEditor(ctx), state, patch, expectedRevision),
    };
}
/** Apply the typert-protocol Remote marker to a prototype (no-decorator shim). */
function markRemote(klass, methodName) {
    if (!protocol?.Remote)
        return;
    const initializers = [];
    const decorator = protocol.Remote(methodName);
    decorator(undefined, {
        name: methodName,
        private: false,
        static: false,
        addInitializer(fn) { initializers.push(fn); },
    });
    const receiver = Object.create(klass.prototype);
    for (const fn of initializers)
        fn.call(receiver);
}
// Explicit any: the two branches are chosen at runtime and the degraded one has
// no Service base class to declare.
let NapcatLifecycleService;
if (protocol?.TypertRemoteService) {
    class NapcatLifecycleRemote extends protocol.TypertRemoteService {
        static inject = ['configEditor', 'profileContext'];
        state = createRevisionState();
        ownerCtx;
        constructor(ctx) {
            super(ctx, NAMESPACE);
            this.ownerCtx = ctx;
        }
        async getStatus() { return resolveLifecycle(this.ownerCtx).status(); }
        async start() { return resolveLifecycle(this.ownerCtx).start(); }
        async stop() { return resolveLifecycle(this.ownerCtx).stop(); }
        async restart() { return resolveLifecycle(this.ownerCtx).restart(); }
        async getConfig() { return getConfig(requireConfigEditor(this.ownerCtx), this.state); }
        async updateConfig(patch, expectedRevision) {
            return updateConfig(requireConfigEditor(this.ownerCtx), this.state, patch, expectedRevision);
        }
    }
    markRemote(NapcatLifecycleRemote, 'getStatus');
    markRemote(NapcatLifecycleRemote, 'start');
    markRemote(NapcatLifecycleRemote, 'stop');
    markRemote(NapcatLifecycleRemote, 'restart');
    markRemote(NapcatLifecycleRemote, 'getConfig');
    markRemote(NapcatLifecycleRemote, 'updateConfig');
    NapcatLifecycleService = NapcatLifecycleRemote;
}
else {
    console.warn('[dsh-napcat-lifecycle] @deepseek-ai/dsh-typert-protocol unavailable — napcatLifecycle remote degrades to a plain cordis service');
    class NapcatLifecyclePlain {
        static inject = ['configEditor', 'profileContext'];
        name = NAMESPACE;
        state = createRevisionState();
        ctx;
        constructor(ctx) { this.ctx = ctx; }
        getStatus() { return resolveLifecycle(this.ctx).status(); }
        start() { return resolveLifecycle(this.ctx).start(); }
        stop() { return resolveLifecycle(this.ctx).stop(); }
        restart() { return resolveLifecycle(this.ctx).restart(); }
        getConfig() { return getConfig(requireConfigEditor(this.ctx), this.state); }
        updateConfig(patch, expectedRevision) {
            return updateConfig(requireConfigEditor(this.ctx), this.state, patch, expectedRevision);
        }
    }
    NapcatLifecycleService = NapcatLifecyclePlain;
}
export default NapcatLifecycleService;
export { NapcatLifecycleService };
