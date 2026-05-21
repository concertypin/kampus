import { createConsola, type Consola, type LogObject } from "consola";

/**
 * Log levels compatible with consola
 * - silent: No output (default for production)
 * - error: Only errors
 * - warn: Errors and warnings
 * - info: General information (--verbose)
 * - debug: Detailed debug info (--debug)
 * - trace: Most verbose, includes fetch details (--trace)
 */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";

/** Map our log levels to consola's numeric levels */
const LOG_LEVEL_MAP: Record<LogLevel, number> = {
    silent: -999, // Consola doesn't have silent, use very low number
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    trace: 4,
};

/**
 * Custom reporter that writes to stderr to avoid mixing with stdin prompts.
 * Uses console.error which works in both Node.js and Deno.
 */
const stderrReporter = {
    log: (logObj: LogObject): void => {
        const tag = logObj.tag ? `${logObj.tag}:` : "";
        const type = logObj.type;
        const message = logObj.args.join(" ");
        // oxlint-disable-next-line no-console
        console.error(`${tag}${type} ${message}`);
    },
};

/** Singleton logger instance - uses stderr to separate from stdin prompts */
const logger: Consola = createConsola({
    level: LOG_LEVEL_MAP.silent,
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
export function getLogger(): Consola {
    return logger;
}

/**
 * Create a scoped logger with a tag
 * @example
 * const log = getLogger().withTag('fetch');
 * log.info('Request sent');
 */
export function createTaggedLogger(tag: string): Consola {
    return logger.withTag(tag);
}
