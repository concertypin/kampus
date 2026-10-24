import {
    createConsola,
    LogLevels,
    type ConsolaInstance,
    type ConsolaOptions,
    type LogObject,
} from "consola";

/**
 * Log levels compatible with consola
 * - silent: No output
 * - error: Only errors
 * - warn: Errors and warnings (default)
 * - info: General information (--verbose)
 * - debug: Detailed debug info (--debug)
 * - trace: Most verbose, includes fetch details (--trace)
 */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";

/** Map our log levels to consola's numeric levels */
const LOG_LEVEL_MAP = {
    silent: LogLevels.silent,
    error: LogLevels.error,
    warn: LogLevels.warn,
    info: LogLevels.info,
    debug: LogLevels.debug,
    trace: LogLevels.trace,
} satisfies Record<LogLevel, number>;

/**
 * An Error as `name: message` (or its stack), followed by its `cause` chain.
 * `seen` stops a cause cycle.
 */
function formatError(
    err: Error,
    includeStack: boolean,
    seen = new Set<Error>()
): string {
    seen.add(err);
    const head =
        includeStack && err.stack ? err.stack : `${err.name}: ${err.message}`;
    const { cause } = err;
    if (cause === undefined || (cause instanceof Error && seen.has(cause))) {
        return head;
    }
    const causeText =
        cause instanceof Error
            ? formatError(cause, includeStack, seen)
            : formatArg(cause, includeStack);
    return `${head}\nCaused by: ${causeText}`;
}

/** Format one log argument without relying on node:util (Deno compatible). */
function formatArg(arg: unknown, includeStack: boolean): string {
    if (typeof arg === "string") return arg;
    if (arg instanceof Error) return formatError(arg, includeStack);
    try {
        // JSON.stringify drops an Error's own fields, so a nested Error
        // (`{ error }`) is written as `name: message` instead of `{}`.
        // It yields undefined for e.g. functions and symbols.
        const json = JSON.stringify(arg, (_key, value: unknown) =>
            value instanceof Error ? `${value.name}: ${value.message}` : value
        );
        return json ?? String(arg);
    } catch {
        // Circular structures, BigInt, ...
        return String(arg);
    }
}

/**
 * Custom reporter that writes to stderr to avoid mixing with stdin prompts.
 * Uses console.error which works in both Node.js and Deno.
 */
const stderrReporter = {
    log: (logObj: LogObject, ctx: { options: ConsolaOptions }): void => {
        const tag = logObj.tag ? `${logObj.tag}:` : "";
        const type = logObj.type;
        const includeStack = ctx.options.level >= LogLevels.debug;
        const message = logObj.args
            .map((arg) => formatArg(arg, includeStack))
            .join(" ");
        // oxlint-disable-next-line no-console
        console.error(`${tag}${type} ${message}`);
    },
};

/** Singleton logger instance - uses stderr to separate from stdin prompts */
const logger: ConsolaInstance = createConsola({
    level: LOG_LEVEL_MAP.warn,
    reporters: [stderrReporter],
});

/**
 * Set the global log level
 */
export function setLogLevel(level: LogLevel): void {
    logger.level = LOG_LEVEL_MAP[level];
}

/**
 * Get the current logger instance
 * Use this to log messages throughout the library
 */
export function getLogger(): ConsolaInstance {
    return logger;
}

/**
 * Create a scoped logger with a tag
 * @example
 * const log = getLogger().withTag('fetch');
 * log.info('Request sent');
 */
export function createTaggedLogger(tag: string): ConsolaInstance {
    return logger.withTag(tag);
}
