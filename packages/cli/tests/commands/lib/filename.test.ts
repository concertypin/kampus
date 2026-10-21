import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import {
    MAX_FILENAME_BYTES,
    claimFilename,
    sanitizeFilename,
} from "@/commands/lib/filename";

describe("sanitizeFilename", () => {
    it("keeps an ordinary name, including Korean and inner dots", () => {
        expect(sanitizeFilename("(1주차) 강의 자료 v1.2.pdf")).toBe(
            "(1주차) 강의 자료 v1.2.pdf"
        );
        expect(sanitizeFilename("..notes.pdf")).toBe("..notes.pdf");
        expect(sanitizeFilename(".env")).toBe(".env");
    });

    it("replaces the colon that would write an NTFS alternate data stream", () => {
        expect(sanitizeFilename("report.pdf:hidden")).toBe("report.pdf_hidden");
        expect(sanitizeFilename("C:evil.txt")).toBe("C_evil.txt");
        expect(sanitizeFilename("a.pdf::$DATA")).toBe("a.pdf__$DATA");
    });

    it("leaves no path separator, so the result is a single component", () => {
        for (const name of [
            "../../etc/passwd",
            "..\\..\\Windows\\system.ini",
            "a/b\\c.pdf",
            "\\\\server\\share\\a.pdf",
        ]) {
            const safe = sanitizeFilename(name);
            expect(safe).not.toMatch(/[/\\]/);
            expect(win32.basename(safe)).toBe(safe);
        }
    });

    it.each(["CON", "con", "NUL", "PRN", "AUX", "COM1", "LPT9", "CONIN$"])(
        "defuses the reserved device name %s",
        (name) => {
            expect(sanitizeFilename(name)).toBe(`_${name}`);
        }
    );

    it("defuses a reserved device name with an extension", () => {
        expect(sanitizeFilename("NUL.txt")).toBe("_NUL.txt");
        expect(sanitizeFilename("con.tar.gz")).toBe("_con.tar.gz");
        expect(sanitizeFilename("aux .pdf")).toBe("_aux .pdf");
        // A reserved name hidden behind what Windows strips
        expect(sanitizeFilename("NUL. ")).toBe("_NUL");
    });

    it("leaves names that only contain a device name alone", () => {
        expect(sanitizeFilename("console.log")).toBe("console.log");
        expect(sanitizeFilename("null.pdf")).toBe("null.pdf");
        expect(sanitizeFilename("COM10.txt")).toBe("COM10.txt");
    });

    it("drops trailing dots and spaces, which Windows removes silently", () => {
        expect(sanitizeFilename("notes.pdf. .")).toBe("notes.pdf");
        expect(sanitizeFilename("notes ")).toBe("notes");
    });

    it("returns an empty string when nothing usable is left", () => {
        expect(sanitizeFilename("")).toBe("");
        expect(sanitizeFilename(".")).toBe("");
        expect(sanitizeFilename("..")).toBe("");
        expect(sanitizeFilename(" . . ")).toBe("");
    });

    it("removes control characters and collapses whitespace", () => {
        expect(sanitizeFilename("a\u0000b\u001fc.pdf")).toBe("abc.pdf");
        expect(sanitizeFilename("a\r\n\tb   c.pdf")).toBe("a b c.pdf");
    });

    it("replaces the other characters Windows forbids", () => {
        expect(sanitizeFilename('a<b>c"d|e?f*g.pdf')).toBe("a_b_c_d_e_f_g.pdf");
    });
});

describe("claimFilename", () => {
    it("returns a free name unchanged", () => {
        const taken = new Set<string>();

        expect(claimFilename("a.pdf", taken)).toBe("a.pdf");
        expect(claimFilename("b.pdf", taken)).toBe("b.pdf");
    });

    it("numbers a repeated name before the extension", () => {
        const taken = new Set<string>();

        expect(claimFilename("다운로드.pdf", taken)).toBe("다운로드.pdf");
        expect(claimFilename("다운로드.pdf", taken)).toBe("다운로드 (2).pdf");
        expect(claimFilename("다운로드.pdf", taken)).toBe("다운로드 (3).pdf");
    });

    it("numbers a repeated name without an extension", () => {
        const taken = new Set<string>();

        expect(claimFilename("다운로드", taken)).toBe("다운로드");
        expect(claimFilename("다운로드", taken)).toBe("다운로드 (2)");
        expect(claimFilename(".env", taken)).toBe(".env");
        expect(claimFilename(".env", taken)).toBe(".env (2)");
    });

    it("treats names that differ only by case as the same file", () => {
        const taken = new Set<string>();

        expect(claimFilename("Notes.PDF", taken)).toBe("Notes.PDF");
        expect(claimFilename("notes.pdf", taken)).toBe("notes (2).pdf");
    });

    it("does not hand out a numbered name that is already in use", () => {
        const taken = new Set<string>();

        expect(claimFilename("a (2).pdf", taken)).toBe("a (2).pdf");
        expect(claimFilename("a.pdf", taken)).toBe("a.pdf");
        expect(claimFilename("a.pdf", taken)).toBe("a (3).pdf");
    });
});

describe("sanitizeFilename: invisible characters", () => {
    it("removes C1 control characters", () => {
        expect(sanitizeFilename("a\u0080b\u0085c\u009Bd\u009F.pdf")).toBe(
            "abcd.pdf"
        );
    });

    it("removes bidirectional controls, so the shown extension is the real one", () => {
        // Displayed as "reportexe.pdf" with the override in place
        expect(sanitizeFilename("report\u202Efdp.exe")).toBe("reportfdp.exe");
        expect(
            sanitizeFilename(
                "\u202Aa\u202Bb\u202Cc\u202Dd\u2066e\u2067f\u2068g\u2069.txt"
            )
        ).toBe("abcdefg.txt");
        expect(sanitizeFilename("a\u200Eb\u200Fc\u061Cd.txt")).toBe("abcd.txt");
    });

    it("removes zero-width characters", () => {
        expect(
            sanitizeFilename("in\u200Bvoice\u200C\u200D\u2060\uFEFF.pdf")
        ).toBe("invoice.pdf");
        // Two names that only differed by an invisible character are equal
        expect(sanitizeFilename("a\u200Bb.pdf")).toBe(
            sanitizeFilename("ab.pdf")
        );
    });

    it("removes terminal escape sequences' control characters", () => {
        expect(sanitizeFilename("\u001b[31mred\u001b[0m\u0007.txt")).toBe(
            "[31mred[0m.txt"
        );
    });

    it("still turns tabs and line breaks into a single space", () => {
        expect(sanitizeFilename("a\tb\r\nc d.pdf")).toBe("a b c d.pdf");
    });

    it("returns an empty name when only invisible characters were given", () => {
        expect(sanitizeFilename("\u202E\u200B\u0085")).toBe("");
    });
});

describe("sanitizeFilename: length", () => {
    const bytes = (name: string): number => Buffer.byteLength(name, "utf8");

    it("keeps a name that is within the limit", () => {
        const name = `${"가".repeat(70)}.pdf`; // 214 bytes
        expect(sanitizeFilename(name)).toBe(name);
    });

    it("shortens a long ASCII name and keeps the extension", () => {
        const safe = sanitizeFilename(`${"a".repeat(300)}.pdf`);

        expect(bytes(safe)).toBe(MAX_FILENAME_BYTES);
        expect(safe.endsWith(".pdf")).toBe(true);
        expect(safe).toBe(`${"a".repeat(MAX_FILENAME_BYTES - 4)}.pdf`);
    });

    it("counts bytes, not characters: a long Korean name fits 255 bytes", () => {
        // 100 characters, 300 bytes: fine for NTFS, too long for ext4/APFS
        const safe = sanitizeFilename(`${"강".repeat(100)}.hwp`);

        expect(bytes(safe)).toBeLessThanOrEqual(MAX_FILENAME_BYTES);
        expect(safe.endsWith(".hwp")).toBe(true);
        // Whole characters only: (240 - 4) / 3 = 78
        expect(safe).toBe(`${"강".repeat(78)}.hwp`);
    });

    it("does not split a surrogate pair", () => {
        const safe = sanitizeFilename(`${"😀".repeat(100)}.png`);

        expect(bytes(safe)).toBeLessThanOrEqual(MAX_FILENAME_BYTES);
        expect(safe.isWellFormed()).toBe(true);
        expect(safe).toBe(`${"😀".repeat(59)}.png`);
    });

    it("does not split a base character from its combining marks", () => {
        // "e" + combining acute + combining diaeresis: 5 bytes per cluster
        const cluster = "e\u0301\u0308";
        const safe = sanitizeFilename(`${cluster.repeat(100)}.txt`);

        expect(bytes(safe)).toBeLessThanOrEqual(MAX_FILENAME_BYTES);
        const stem = safe.slice(0, -".txt".length);
        expect(stem.length % cluster.length).toBe(0);
        expect(stem).toBe(cluster.repeat(stem.length / cluster.length));
    });

    it("does not split decomposed Hangul (NFD) inside a syllable", () => {
        const syllable = "강".normalize("NFD"); // three jamo, 9 bytes
        const safe = sanitizeFilename(`${syllable.repeat(60)}.pdf`);

        expect(bytes(safe)).toBeLessThanOrEqual(MAX_FILENAME_BYTES);
        const stem = safe.slice(0, -".pdf".length);
        expect(stem).toBe(syllable.repeat(stem.length / syllable.length));
        expect(stem.normalize("NFC")).toBe("강".repeat(26));
    });

    it("treats an over-long 'extension' as part of the name", () => {
        const safe = sanitizeFilename(`a.${"b".repeat(300)}`);

        expect(bytes(safe)).toBe(MAX_FILENAME_BYTES);
        expect(safe.startsWith("a.bbb")).toBe(true);
    });

    it("leaves no trailing dot or space where the name was cut", () => {
        const safe = sanitizeFilename(`${"a".repeat(235)} . . . . tail.pdf`);

        expect(safe).toBe(`${"a".repeat(235)}.pdf`);
    });

    it("leaves room for the suffix of a second file with the same name", () => {
        const safe = sanitizeFilename(`${"가".repeat(200)}.pdf`);
        const taken = new Set<string>();

        claimFilename(safe, taken);
        const second = claimFilename(safe, taken);

        expect(second.endsWith(" (2).pdf")).toBe(true);
        expect(bytes(second)).toBeLessThanOrEqual(255);
    });

    describe("on the real filesystem", () => {
        let dir: string;

        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), "kampus-names-"));
        });

        afterEach(() => {
            rmSync(dir, { recursive: true, force: true });
        });

        it.each([
            ["300 ASCII characters", `${"a".repeat(300)}.pdf`],
            ["100 Korean characters", `${"강".repeat(100)}.hwp`],
            ["100 emoji", `${"😀".repeat(100)}.png`],
            [
                "a name with bidi and zero-width characters",
                `report\u202E\u200B${"x".repeat(280)}.pdf`,
            ],
        ])("a name of %s can be created, and read back", (_label, name) => {
            const safe = sanitizeFilename(name);
            const second = claimFilename(safe, new Set([safe.toLowerCase()]));

            writeFileSync(join(dir, safe), "one");
            writeFileSync(join(dir, second), "two");

            expect(readdirSync(dir).sort()).toEqual([safe, second].sort());
            expect(readFileSync(join(dir, safe), "utf8")).toBe("one");
            expect(readFileSync(join(dir, second), "utf8")).toBe("two");
        });

        it("the unshortened name is the one the filesystem refuses", () => {
            expect(() =>
                writeFileSync(join(dir, `${"a".repeat(300)}.pdf`), "x")
            ).toThrow(/ENAMETOOLONG|ENOENT|EINVAL/);
        });
    });
});
