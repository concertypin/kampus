import { type LogLevel } from "@concertypin/ecampus-crawler";

let _optsFn: (() => Record<string, unknown>) | null = null;

/**
 * Register the function that provides global CLI options.
 * Called once from the entry point after Commander program is created.
 */
export function setProgramOptsFn(fn: () => Record<string, unknown>): void {
    _optsFn = fn;
}

/**
 * Get the log level from global CLI options (--verbose, --debug, --trace).
 * Must be called after Commander parses argv (e.g., inside a .action() handler).
 */
export function getLogLevel(): LogLevel | undefined {
    if (!_optsFn) return undefined;
    const opts = _optsFn();
    if (opts.trace) return "trace";
    if (opts.debug) return "debug";
    if (opts.verbose) return "info";
    return undefined;
}
