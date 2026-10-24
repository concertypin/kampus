/**
 * File names for downloads. The names come from the server (URLs,
 * Content-Disposition, link text, activity titles), so they are made safe
 * before they are joined to a local folder.
 */

/** Characters that are path syntax or invalid in a Windows file name. */
const FORBIDDEN_CHARS = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);

/**
 * Device names Windows reserves in every folder, with or without an
 * extension (`CON`, `NUL.txt`): opening one talks to the device, and the
 * downloaded content is lost.
 */
const RESERVED_DEVICE_NAME =
    /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])\s*(\..*)?$/i;

/**
 * Longest file name produced, in UTF-8 bytes. ext4 and APFS allow 255 bytes
 * per name and NTFS 255 UTF-16 units (never more than the byte count); the
 * margin leaves room for the ` (2)` suffix of {@link claimFilename}.
 */
export const MAX_FILENAME_BYTES = 240;

/** An extension longer than this is a dot in a long name, not an extension. */
const MAX_EXTENSION_BYTES = 32;

/**
 * Characters that are not shown, or that change how the text around them is
 * shown: control characters (`Cc`), format characters (`Cf`: soft hyphen,
 * zero-width characters, bidirectional controls, tag characters) and the
 * line and paragraph separators. `report<U+202E>fdp.exe` is displayed as
 * `reportexe.pdf`, and an escape character starts a terminal control
 * sequence. The library logger strips the same set.
 */
const INVISIBLE_CHAR = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]$/u;

export function isInvisibleChar(ch: string): boolean {
    return INVISIBLE_CHAR.test(ch);
}

function byteLength(text: string): number {
    return Buffer.byteLength(text, "utf8");
}

/**
 * Shorten a name to at most `maxBytes` UTF-8 bytes, keeping its extension.
 * The stem is cut between grapheme clusters, so neither a surrogate pair
 * nor a base character and its combining marks are split.
 */
function truncateFilename(name: string, maxBytes: number): string {
    if (byteLength(name) <= maxBytes) return name;

    const dot = name.lastIndexOf(".");
    // A leading dot (".env") is part of the stem, not an extension
    let ext = dot > 0 ? name.slice(dot) : "";
    if (byteLength(ext) > MAX_EXTENSION_BYTES || ext.includes(" ")) ext = "";
    const stem = ext ? name.slice(0, dot) : name;

    const budget = maxBytes - byteLength(ext);
    let kept = "";
    let used = 0;
    const graphemes = new Intl.Segmenter(undefined, {
        granularity: "grapheme",
    });
    for (const { segment } of graphemes.segment(stem)) {
        const size = byteLength(segment);
        if (used + size > budget) break;
        kept += segment;
        used += size;
    }
    kept = kept.replace(/[. ]+$/, "");
    return kept ? kept + ext : "";
}

/**
 * Turn a server-provided name into a single, safe file name component.
 *
 * - path separators and the characters Windows forbids become `_`. This
 *   includes `:`, which on NTFS would otherwise write an alternate data
 *   stream (`a.pdf:x` creates a stream on `a.pdf`)
 * - control characters (C0 and C1), zero-width characters and bidirectional
 *   controls are removed, whitespace is collapsed
 * - trailing dots and spaces, which Windows drops silently, are removed (so
 *   `.` and `..` do not survive either)
 * - the name is shortened to {@link MAX_FILENAME_BYTES} UTF-8 bytes, keeping
 *   the extension
 * - a reserved device name is prefixed with `_`
 *
 * Returns "" when nothing usable is left; callers supply a fallback name.
 */
export function sanitizeFilename(name: string): string {
    let safe = "";
    for (const ch of name) {
        if (FORBIDDEN_CHARS.has(ch)) safe += "_";
        // Tab and line breaks (C0 controls, U+2028/U+2029) are invisible
        // characters too, but become a space: test them first. Other
        // invisible characters, the BOM included, are dropped.
        else if (/[\t\n\v\f\r\u2028\u2029]/.test(ch)) safe += " ";
        else if (isInvisibleChar(ch)) continue;
        else if (/\s/.test(ch)) safe += " ";
        else safe += ch;
    }
    safe = safe
        .replace(/ +/g, " ")
        .trim()
        .replace(/[. ]+$/, "");
    safe = truncateFilename(safe, MAX_FILENAME_BYTES);
    if (RESERVED_DEVICE_NAME.test(safe)) safe = `_${safe}`;
    return safe;
}

/**
 * Reserve a file name within one download run.
 *
 * Returns `name` when it is free, otherwise `stem (2).ext`, `stem (3).ext`,
 * ... so two files with the same name do not overwrite each other. Names are
 * compared without regard to case or Unicode form, as Windows and macOS file
 * systems do. The returned name is recorded in `taken`.
 */
export function claimFilename(name: string, taken: Set<string>): string {
    const key = (value: string): string => value.normalize("NFC").toLowerCase();

    let candidate = name;
    if (taken.has(key(candidate))) {
        const dot = name.lastIndexOf(".");
        // A leading dot (".env") is part of the stem, not an extension
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        for (let n = 2; taken.has(key(candidate)); n++) {
            candidate = `${stem} (${n})${ext}`;
        }
    }
    taken.add(key(candidate));
    return candidate;
}
