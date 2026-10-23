import { isTTY, pc } from "./format.ts";

/**
 * A disposable spinner for CLI loading states.
 *
 * Uses the `using` keyword (TypeScript 5.2+ / ES2022 explicit resource
 * management) to guarantee the spinner is cleared when the scope exits —
 * even on early returns or thrown errors.
 *
 * @example
 * ```ts
 * using spin = spinner("Loading...");
 * const result = await fetchData();
 * spin.stop(); // clear spinner before printing results
 * console.log(result);
 * // `spin` auto-disposes here — safe even if stop() wasn't called
 * ```
 */
export function spinner(
    msg: string
): Disposable & { stop(): void; update(msg: string): void } {
    let active = isTTY;
    if (active) {
        process.stdout.write(pc.dim(msg));
    }
    return {
        update(newMsg: string) {
            if (active) {
                process.stdout.write(`\r${pc.dim(newMsg)}`);
            }
        },
        stop() {
            if (active) {
                process.stdout.write(`\r${" ".repeat(40)}\r`);
                active = false;
            }
        },
        [Symbol.dispose]() {
            this.stop();
        },
    };
}
