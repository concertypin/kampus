import { createColors } from "picocolors";

/**
 * Whether the current stdout is a TTY (interactive terminal).
 * When false, output should be plaintext-friendly (no emoji,
 * no box-drawing characters, no carriage-return spinners).
 */
export const isTTY = process.stdout.isTTY ?? false;

/**
 * A picocolors instance that respects TTY detection.
 * On Windows, the default picocolors instance always enables colors
 * regardless of TTY. This instance only enables colors when stdout
 * is a real terminal.
 */
export const pc = createColors(isTTY);

/**
 * Returns a dimmed separator string appropriate for the output mode.
 * TTY: box-drawing '─' character repeated
 * Non-TTY: plain '-' dashes repeated
 */
export function separator(width = 40): string {
    const char = isTTY ? "─" : "-";
    return pc.dim(char.repeat(width));
}

/**
 * Strip or replace emoji when output is not a TTY.
 * In non-TTY mode, emoji are replaced with ASCII markers
 * or removed entirely to avoid garbled characters in pipes.
 */
export function stripEmoji(text: string): string {
    if (isTTY) return text;
    return text
        .replace(/✅/g, "[OK]")
        .replace(/❌/g, "[ERR]")
        .replace(/⚠️/g, "[WARN]")
        .replace(/✓/g, "[+]")
        .replace(/✗/g, "[-]")
        .replace(/📚\s*/g, "")
        .replace(/📝\s*/g, "")
        .replace(/🧩\s*/g, "")
        .replace(/📋\s*/g, "")
        .replace(/✉️\s*/g, "")
        .replace(/📥\s*/g, "")
        .replace(/→/g, "->");
}

// ── Spinner helpers ──────────────────────────────────────────────

/**
 * Carriage-return prefix for overwriting the current line.
 * In non-TTY mode this is empty to avoid `\r` artifacts in pipes.
 */
export const cr = isTTY ? "\r" : "";

/**
 * Trailing spaces used to fully clear a loading spinner line.
 * In non-TTY mode this is empty (no spinner line to clear).
 */
export const pad = isTTY ? " ".repeat(10) : "";

let spinnerActive = false;

/**
 * Start a loading spinner message (no newline, overwritten later).
 * In non-TTY mode this is a no-op to avoid carriage-return artifacts.
 */
export function spinnerStart(msg: string): void {
    if (isTTY) {
        process.stdout.write(pc.dim(msg));
        spinnerActive = true;
    }
}

/**
 * Clear the active loading spinner line.
 * In non-TTY mode this is a no-op.
 */
export function spinnerStop(): void {
    if (isTTY && spinnerActive) {
        process.stdout.write(`\r${" ".repeat(40)}\r`);
        spinnerActive = false;
    }
}
