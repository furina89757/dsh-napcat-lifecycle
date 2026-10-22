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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { LifecycleState, RestartState } from './state.js';
/** Runtime configuration. */
export interface Config {
    enabled: boolean;
    napcatDir: string;
    qqExe: string;
    botQQ: string;
    autoStart: boolean;
    waitPort: number;
    waitPortTimeoutMs: number;
    gracefulShutdownMs: number;
    restartOnExit: boolean;
    maxRestarts: number;
    restartDelayMs: number;
    stdoutLogPath: string;
    stdoutLogMaxBytes: number;
    statePath: string;
}
export declare const Config: z<Config>;
/** One status snapshot for the panel and for tools. */
export interface LifecycleStatus {
    state: LifecycleState;
    running: boolean;
    botQQ: string;
    startedAt: number | null;
    restarts: number;
    maxRestarts: number;
    loginFailure: string | null;
    lastExit: RestartState['lastExit'] | null;
    webuiUrl: string;
    recentLog: string;
}
/** The service the client bundle and tools read. */
export interface LifecycleService {
    status(): LifecycleStatus;
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
/** The plugin name used in logs and effect labels. */
export declare const name = "napcat-lifecycle";
/** Host services this plugin consumes. */
export declare const inject: string[];
/**
 * Mount the lifecycle plugin.
 * @param ctx - plugin context.
 * @param config - validated configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
