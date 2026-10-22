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
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
/**
 * Resolve the NapCat Shell layout from its directory.
 * @param dir - the extracted NapCat.Shell directory.
 * @returns absolute paths for every file the launcher needs.
 */
export function resolveLayout(dir) {
    return {
        dir,
        bootExe: join(dir, 'NapCatWinBootMain.exe'),
        hookDll: join(dir, 'NapCatWinBootHook.dll'),
        patchPackage: join(dir, 'qqnt.json'),
        loadPath: join(dir, 'loadNapCat.js'),
        mainPath: join(dir, 'napcat.mjs'),
    };
}
/**
 * Build the launcher environment.
 * @param layout - resolved NapCat layout.
 * @returns the five NAPCAT_* variables, verbatim from launcher.bat.
 */
export function buildEnv(layout) {
    return {
        NAPCAT_PATCH_PACKAGE: layout.patchPackage,
        NAPCAT_LOAD_PATH: layout.loadPath,
        NAPCAT_INJECT_PATH: layout.hookDll,
        NAPCAT_LAUNCHER_PATH: layout.bootExe,
        NAPCAT_MAIN_PATH: layout.mainPath,
    };
}
/**
 * Verify every file the launcher needs exists; returns the missing ones.
 * @param layout - resolved NapCat layout.
 * @returns missing absolute paths (empty = ready).
 */
export async function missingFiles(layout) {
    const required = [layout.bootExe, layout.hookDll, layout.patchPackage, layout.loadPath, layout.mainPath];
    const missing = [];
    for (const file of required) {
        try {
            await access(file, constants.F_OK);
        }
        catch {
            missing.push(file);
        }
    }
    return missing;
}
/**
 * Wait until a TCP port is accepting connections.
 * @param port - port to poll.
 * @param timeoutMs - give up after this long.
 * @param intervalMs - poll interval.
 * @returns true when the port opened, false on timeout.
 */
export async function waitForPort(port, timeoutMs, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    const net = await import('node:net');
    while (Date.now() < deadline) {
        const open = await new Promise(resolve => {
            const socket = net.createConnection({ host: '127.0.0.1', port });
            const finish = (value) => {
                socket.removeAllListeners();
                socket.destroy();
                resolve(value);
            };
            socket.once('connect', () => finish(true));
            socket.once('error', () => finish(false));
            socket.setTimeout(1000, () => finish(false));
        });
        if (open)
            return true;
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return false;
}
/**
 * Spawn NapCat as a host-managed child process.
 * @param options - spawn inputs.
 * @returns the live handle.
 */
export function startNapcat(options) {
    const { subprocess, log, layout, qqExe, botQQ, graceMs } = options;
    const env = buildEnv(layout);
    const argv = [layout.bootExe, qqExe, layout.hookDll, '-q', botQQ];
    log.info('[napcat-lifecycle] spawning: ' + argv.join(' '));
    // stdout is COLLECTED (bounded tail) and optionally SPILLED: the in-memory
    // tail serves the status panel's "recent log", while the spill file keeps the
    // complete stream (the login QR code + the failure line that explains it)
    // readable after the tail rotates.
    const stdout = { maxBytes: options.stdoutMaxBytes ?? 256 * 1024 };
    if (options.stdoutSpillPath !== undefined && options.stdoutSpillPath !== '') {
        stdout.spill = {
            path: options.stdoutSpillPath,
            maxBytes: options.stdoutSpillMaxBytes ?? 8 * 1024 * 1024,
        };
    }
    return subprocess.spawn({
        argv,
        cwd: layout.dir,
        stdio: {
            stdin: 'ignore',
            stdout,
            stderr: 'inherit',
        },
        graceMs,
        env: env,
    });
}
/** Login-failure markers NapCat prints when the stored credential is gone.
 * A match means the process is healthy but needs a human to scan the QR code,
 * so restarting cannot help. */
export const LOGIN_FAILURE_MARKERS = [
    '登录态已失效',
    '快速登录错误',
    '请扫描下面的二维码',
    '将使用二维码登录方式',
];
/**
 * Whether recent output shows a login failure (needs a human, not a restart).
 * @param output - recent stdout text.
 * @returns the matched marker, or undefined.
 */
export function detectLoginFailure(output) {
    for (const marker of LOGIN_FAILURE_MARKERS) {
        if (output.includes(marker))
            return marker;
    }
    return undefined;
}
/** Read the whole collected stdout tail as text ('' when unavailable). */
export function readOutput(handle) {
    const reader = handle.collected?.stdout;
    if (reader === undefined)
        return '';
    try {
        const slice = reader.readFrom(0);
        return slice.text;
    }
    catch {
        return '';
    }
}
/**
 * Terminate a spawned NapCat and wait for its process range to go quiet.
 * Idempotent: a handle whose process already exited resolves immediately.
 * @param handle - the live handle (undefined = nothing to do).
 * @param log - logger.
 */
export async function stopNapcat(handle, log) {
    if (handle === undefined)
        return;
    log.info('[napcat-lifecycle] terminating NapCat...');
    try {
        await handle.terminate();
    }
    catch (error) {
        log.warn('[napcat-lifecycle] terminate failed: ' + String(error));
    }
    try {
        await handle.waitForExit();
        log.info('[napcat-lifecycle] NapCat process range is quiet');
    }
    catch (error) {
        log.warn('[napcat-lifecycle] waitForExit failed: ' + String(error));
    }
}
