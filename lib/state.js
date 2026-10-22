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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
/** Fresh bookkeeping. */
export function emptyRestartState() {
    return { restarts: 0 };
}
/**
 * Read the persisted restart state.
 * @param path - state file path.
 * @returns the stored state, or a fresh one when absent/corrupt.
 */
export async function loadRestartState(path) {
    try {
        const raw = await readFile(path, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null)
            return emptyRestartState();
        return {
            restarts: typeof parsed.restarts === 'number' && Number.isFinite(parsed.restarts) ? parsed.restarts : 0,
            ...(parsed.lastExit === undefined ? {} : { lastExit: parsed.lastExit }),
            ...(parsed.loginFailure === undefined ? {} : { loginFailure: parsed.loginFailure }),
        };
    }
    catch {
        return emptyRestartState();
    }
}
/**
 * Persist the restart state (best-effort: a write failure only warns).
 * @param path - state file path.
 * @param state - state to store.
 * @param log - logger.
 */
export async function saveRestartState(path, state, log) {
    try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(state, null, 2), 'utf8');
    }
    catch (error) {
        log.warn('[napcat-lifecycle] restart state write failed: ' + String(error));
    }
}
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
export function restartDecision(state, restarts, maxRestarts) {
    if (state === 'awaiting-login') {
        return { allowed: false, reason: 'login-required' };
    }
    if (state === 'stopped') {
        return { allowed: false, reason: 'stopped' };
    }
    if (restarts >= maxRestarts) {
        return { allowed: false, reason: 'budget-exhausted' };
    }
    return { allowed: true, reason: 'crash' };
}
