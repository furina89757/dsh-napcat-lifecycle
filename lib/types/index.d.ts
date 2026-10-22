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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Runtime configuration. */
export interface Config {
    /** Master switch; false mounts the plugin idle. */
    enabled: boolean;
    /** NapCat Shell directory (holds NapCatWinBootMain.exe). */
    napcatDir: string;
    /** QQ.exe absolute path; empty = resolve from the well-known install path. */
    qqExe: string;
    /** Bot QQ number for quick login. */
    botQQ: string;
    /** Spawn NapCat when the plugin loads. */
    autoStart: boolean;
    /** OneBot reverse-WS port to wait for before spawning (0 = do not wait). */
    waitPort: number;
    /** How long to wait for that port. */
    waitPortTimeoutMs: number;
    /** Grace period handed to the subprocess service on terminate. */
    gracefulShutdownMs: number;
    /** Restart NapCat when it exits unexpectedly. */
    restartOnExit: boolean;
    /** Cap on consecutive restarts before giving up. */
    maxRestarts: number;
    /** Delay before a restart attempt. */
    restartDelayMs: number;
}
export declare const Config: z<Config>;
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
