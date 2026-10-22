/**
 * NapCat process management: resolve the install layout, build the spawn
 * request (the five NAPCAT_* environment variables the Shell launcher would
 * have set), and expose a start/stop pair the plugin lifecycle drives.
 *
 * The child is spawned through `ctx.subprocess` so the host owns the process
 * range: when the subprocess service disposes (host shutdown, plugin reload),
 * every descendant is terminated and joined — that is the atomicity guarantee
 * an external watchdog script cannot provide.
 * @module dsh-napcat-lifecycle/napcat
 */
/** The five environment variables NapCat's launcher.bat sets. */
export interface NapcatEnv {
    NAPCAT_PATCH_PACKAGE: string;
    NAPCAT_LOAD_PATH: string;
    NAPCAT_INJECT_PATH: string;
    NAPCAT_LAUNCHER_PATH: string;
    NAPCAT_MAIN_PATH: string;
}
/** Resolved file layout inside a NapCat Shell directory. */
export interface NapcatLayout {
    dir: string;
    bootExe: string;
    hookDll: string;
    patchPackage: string;
    loadPath: string;
    mainPath: string;
}
/** Minimal subprocess handle surface this plugin needs. */
export interface SpawnedProcess {
    done: Promise<{
        exitCode: number | null;
        signal: string | null;
    }>;
    terminate(): Promise<void>;
    waitForExit(): Promise<void>;
}
/** The subprocess capability this plugin consumes. */
export interface SubprocessPort {
    resolveExecutable(name: string): Promise<string>;
    spawn(request: {
        argv: string[];
        cwd: string;
        stdio: Record<string, unknown>;
        graceMs: number;
        env?: Record<string, string | undefined>;
    }): SpawnedProcess;
}
/** Logger surface (a subset of the host logger). */
export interface LoggerPort {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
}
/**
 * Resolve the NapCat Shell layout from its directory.
 * @param dir - the extracted NapCat.Shell directory.
 * @returns absolute paths for every file the launcher needs.
 */
export declare function resolveLayout(dir: string): NapcatLayout;
/**
 * Build the launcher environment.
 * @param layout - resolved NapCat layout.
 * @returns the five NAPCAT_* variables, verbatim from launcher.bat.
 */
export declare function buildEnv(layout: NapcatLayout): NapcatEnv;
/**
 * Verify every file the launcher needs exists; returns the missing ones.
 * @param layout - resolved NapCat layout.
 * @returns missing absolute paths (empty = ready).
 */
export declare function missingFiles(layout: NapcatLayout): Promise<string[]>;
/**
 * Wait until a TCP port is accepting connections.
 * @param port - port to poll.
 * @param timeoutMs - give up after this long.
 * @param intervalMs - poll interval.
 * @returns true when the port opened, false on timeout.
 */
export declare function waitForPort(port: number, timeoutMs: number, intervalMs?: number): Promise<boolean>;
/** What a start call needs from the plugin. */
export interface StartOptions {
    subprocess: SubprocessPort;
    log: LoggerPort;
    layout: NapcatLayout;
    /** QQ.exe absolute path (verified by the caller). */
    qqExe: string;
    /** Bot QQ number for quick login. */
    botQQ: string;
    /** Grace period handed to the subprocess service on terminate. */
    graceMs: number;
    /** Captured-output cap for stdout (bytes). */
    stdoutMaxBytes?: number;
}
/**
 * Spawn NapCat as a host-managed child process.
 * @param options - spawn inputs.
 * @returns the live handle.
 */
export declare function startNapcat(options: StartOptions): SpawnedProcess;
/**
 * Terminate a spawned NapCat and wait for its process range to go quiet.
 * Idempotent: a handle whose process already exited resolves immediately.
 * @param handle - the live handle (undefined = nothing to do).
 * @param log - logger.
 */
export declare function stopNapcat(handle: SpawnedProcess | undefined, log: LoggerPort): Promise<void>;
