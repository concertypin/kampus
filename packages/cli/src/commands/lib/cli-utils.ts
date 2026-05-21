import pc from "picocolors";

/**
 * Start a spinner-style progress message (no newline).
 * Pair with spinnerClear() or overwrite with "\r" in the first console.log.
 */
export function spinnerStart(label: string): void {
    process.stdout.write(pc.dim(`${label}...`));
}

/**
 * Format an unknown error into a consistent CLI error message.
 */
export function formatCliError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    return pc.red(`❌ 오류: ${message}`);
}
