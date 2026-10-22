/**
 * NapCat lifecycle state machine and its durable restart counter.
 *
 * The plugin distinguishes four states, and only two of them may trigger a
 * restart:
 *
 *   starting          → spawn in flight
 *   running           → process alive, OneBot reachable or still warming up
 *   awaiting-login    → process alive but the QQ credential is gone; a human
 *                       must scan the QR code. Restarting cannot help and only
 *                       corrupts the credential further.
 *   stopped           → no process (clean shutdown or after giving up)
 *
 * The restart counter is persisted so a plugin reload cannot reset the budget
 * and turn a crash loop into an infinite loop.
 * @module dsh-napcat-lifecycle/state
 */
/** The lifecycle states. */
export type LifecycleState = 'starting' | 'running' | 'awaiting-login' | 'stopped';
/** Durable restart bookkeeping. */
export interface RestartState {
    /** Consecutive restarts since the last healthy run. */
    restarts: number;
    /** Why the last run ended. */
    lastExit?: {
        at: number;
        exitCode: number | null;
        signal: string | null;
        reason: string;
    };
    /** Last observed login failure marker, when the state is awaiting-login. */
    loginFailure?: {
        at: number;
        marker: string;
    };
}
/** Fresh bookkeeping. */
export declare function emptyRestartState(): RestartState;
/**
 * Read the persisted restart state.
 * @param path - state file path.
 * @returns the stored state, or a fresh one when absent/corrupt.
 */
export declare function loadRestartState(path: string): Promise<RestartState>;
/**
 * Persist the restart state (best-effort: a write failure only warns).
 * @param path - state file path.
 * @param state - state to store.
 * @param log - logger.
 */
export declare function saveRestartState(path: string, state: RestartState, log: {
    warn(message: string): void;
}): Promise<void>;
/**
 * Whether a restart is allowed in the given state.
 *
 * `awaiting-login` is deliberately excluded: the process is alive, the failure
 * is the stored credential, and only a human can fix it. Restarting would
 * spawn a second QQ against the same profile and can invalidate the credential
 * again — the exact failure this plugin hit on 2026-10-22.
 * @param state - current lifecycle state.
 * @param restarts - restarts already spent.
 * @param maxRestarts - configured cap.
 * @returns the decision and the reason when refused.
 */
export declare function restartDecision(state: LifecycleState, restarts: number, maxRestarts: number): {
    allowed: boolean;
    reason: string;
};
