import { expect, vi } from "vitest";

const ALLOWED_STRINGS = new Set([
    "then",
    "toJSON",
    "inspect",
    "constructor",
    "prototype",
    "asymmetricMatch",
    "nodeType",
    "valueOf",
    "$$typeof",
    "length",
]);

/**
 * Creates a proxy of type T from a partial object.
 * If missing properties are accessed, it throws an error.
 * Note that symbol properties are not checked and will be returned as-is.
 * Some default properties are always allowed (see {@link ALLOWED_STRINGS}).
 *
 * @param target - The partial object to create a proxy from.
 * @param allowed - A set of allowed property names that can be accessed without throwing.
 * @returns A proxy of type T.
 */
export function fragile<const T extends object>(
    target: Partial<T>,
    allowed: Set<string> | string[] = []
): T {
    if (Array.isArray(allowed)) {
        return fragile(target, new Set(allowed));
    }
    return new Proxy(target as T, {
        get(obj, prop, receiver) {
            if (typeof prop === "symbol") {
                return Reflect.get(obj, prop, receiver);
            }
            if (prop in obj) {
                return Reflect.get(obj, prop, receiver);
            }
            if (ALLOWED_STRINGS.has(prop)) {
                return Reflect.get(obj, prop, receiver);
            }
            if (allowed.has(prop)) {
                return Reflect.get(obj, prop, receiver);
            }
            throw new Error(`Property ${String(prop)} is missing`);
        },
    });
}

/**
 * A string as a hostile server could send it: ANSI/OSC escape sequences,
 * BEL, a carriage return, NUL, a C1 control, a zero-width space and
 * bidirectional override/isolate characters, a line separator and a
 * Unicode tag character around plain text.
 */
export const HOSTILE =
    "a\u001b[2Jb\u001b]0;owned\u0007c\rd\u0000e\u202Ef\u200Bg\u2066h\u009Bi\u2028j\u{E0041}k";

/** What is left of {@link HOSTILE} on one line of text output. */
export const HOSTILE_CLEAN = "a[2Jb]0;ownedc defghi jk";

/** Part of {@link HOSTILE} that survives in text and in block output alike. */
export const HOSTILE_HEAD = "a[2Jb]0;ownedc";

/**
 * Collects everything a command writes to the terminal (console and the raw
 * stdout/stderr streams) into one string. Restore with `vi.restoreAllMocks()`.
 */
export function captureOutput(): { text(): string } {
    const chunks: string[] = [];
    const join = (args: unknown[]): void => {
        chunks.push(args.map(String).join(" "));
    };
    for (const method of ["log", "info", "warn", "error"] as const) {
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) =>
            join(args)
        );
    }
    for (const stream of [process.stdout, process.stderr]) {
        vi.spyOn(stream, "write").mockImplementation((chunk: unknown) => {
            chunks.push(String(chunk));
            return true;
        });
    }
    return { text: () => chunks.join("\n") };
}

/**
 * Asserts that `text` holds no control, escape, invisible or bidirectional
 * formatting character, line breaks excepted.
 */
export function expectNoControlChars(text: string): void {
    const offending = Array.from(text.replaceAll("\n", "")).filter(
        (ch: string) => /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(ch)
    );
    expect(
        offending.map((ch: string) => `U+${ch.codePointAt(0)?.toString(16)}`)
    ).toEqual([]);
}
