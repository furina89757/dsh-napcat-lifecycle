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
/** patch insert id of the main plugin entry (the config override target). */
export declare const ENTRY_ID = "napcat-lifecycle";
/** Remote namespace = cordis service key on the host. */
export declare const NAMESPACE = "napcatLifecycle";
/** The host service the main plugin row provides. */
export interface LifecycleServiceLike {
    status(): unknown;
    start(): Promise<{
        ok: boolean;
        message: string;
    }>;
    stop(): Promise<{
        ok: boolean;
        message: string;
    }>;
    restart(): Promise<{
        ok: boolean;
        message: string;
    }>;
}
/** Result of a start/stop/restart call. */
export interface ActionResult {
    ok: boolean;
    message: string;
}
/** Config fields the panel may edit. */
export declare const CONFIG_KEYS: readonly string[];
/** Snapshot returned by getConfig/updateConfig. */
export interface ConfigSnapshot {
    revision: number;
    entryActive: boolean;
    config: Record<string, unknown>;
    keys: readonly string[];
}
/** Editor surface this module consumes (host dsh-config-editor). */
interface ConfigEditorEntry {
    options: {
        id?: string;
        config?: Record<string, unknown>;
    };
    fiber?: {
        state?: number;
    };
}
interface ConfigEditorLike {
    entries(): ConfigEditorEntry[];
    edit(entry: ConfigEditorEntry, merge: (fresh: Record<string, unknown>) => Record<string, unknown>): Promise<unknown>;
}
interface RevisionState {
    revision: number;
    fingerprint: string | null;
}
export declare function createRevisionState(): RevisionState;
/** Observe a committed change from ANY source and bump the revision. */
export declare function observeRevision(state: RevisionState, config: unknown): number;
/** Validate an incoming config patch: known keys only, primitive/array values. */
export declare function validatePatch(patch: unknown): Record<string, unknown>;
/** Build the config snapshot from a live entry. */
export declare function buildConfigSnapshot(entry: ConfigEditorEntry, state: RevisionState): ConfigSnapshot;
/** getConfig implementation. */
export declare function getConfig(editor: ConfigEditorLike, state: RevisionState): ConfigSnapshot;
/** updateConfig implementation (positional: patch, expectedRevision). */
export declare function updateConfig(editor: ConfigEditorLike, state: RevisionState, patch: unknown, expectedRevision?: number): Promise<ConfigSnapshot>;
/** Method surface shared by the typert and plain branches. */
export declare function createMethods(ctx: {
    get(key: string): unknown;
}, state?: RevisionState): {
    getStatus(): Promise<unknown>;
    start(): Promise<ActionResult>;
    stop(): Promise<ActionResult>;
    restart(): Promise<ActionResult>;
    getConfig(): Promise<ConfigSnapshot>;
    updateConfig(patch: unknown, expectedRevision?: number): Promise<ConfigSnapshot>;
};
declare let NapcatLifecycleService: any;
export default NapcatLifecycleService;
export { NapcatLifecycleService };
