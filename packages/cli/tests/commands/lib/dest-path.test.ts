import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDestPath } from "@/commands/lib/download-utils";

/**
 * Real directories and real links in a temp directory: no mocked fs, so the
 * link handling that only runs against a real filesystem is exercised.
 * On Windows the links are junctions, which need no special privilege.
 */
function linkDir(target: string, path: string): void {
    symlinkSync(
        target,
        path,
        process.platform === "win32" ? "junction" : "dir"
    );
}

describe("validateDestPath with real links", () => {
    let root: string;
    let realOut: string;
    let outside: string;

    beforeEach(() => {
        root = realpathSync(mkdtempSync(join(tmpdir(), "kampus-dest-")));
        realOut = join(root, "real-out");
        outside = join(root, "outside");
        mkdirSync(realOut);
        mkdirSync(outside);
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    describe("output directory that is itself a link (-o <link>)", () => {
        it("allows the first download into it", () => {
            const out = join(root, "out-link");
            linkDir(realOut, out);

            expect(() =>
                validateDestPath(join(out, "a.pdf"), out)
            ).not.toThrow();
        });

        it("allows downloading the same file again (destination exists)", () => {
            const out = join(root, "out-link");
            linkDir(realOut, out);
            writeFileSync(join(out, "a.pdf"), "first run");

            expect(() =>
                validateDestPath(join(out, "a.pdf"), out)
            ).not.toThrow();
        });

        it("allows it when the directory is reached through a linked parent", () => {
            const parentLink = join(root, "parent-link");
            linkDir(root, parentLink);
            const out = join(parentLink, "real-out");
            writeFileSync(join(realOut, "a.pdf"), "first run");

            expect(() =>
                validateDestPath(join(out, "a.pdf"), out)
            ).not.toThrow();
            expect(() =>
                validateDestPath(join(out, "new.pdf"), out)
            ).not.toThrow();
        });

        it("still rejects a destination outside the linked directory", () => {
            const out = join(root, "out-link");
            linkDir(realOut, out);

            expect(() =>
                validateDestPath(join(out, "..", "outside", "a.pdf"), out)
            ).toThrow("Path traversal detected");
        });
    });

    describe("link inside the output directory that leads out of it", () => {
        it("rejects a new file behind the link", () => {
            linkDir(outside, join(realOut, "escape"));

            expect(() =>
                validateDestPath(join(realOut, "escape", "new.pdf"), realOut)
            ).toThrow("Path traversal detected");
        });

        it("rejects an existing file behind the link", () => {
            linkDir(outside, join(realOut, "escape"));
            writeFileSync(join(outside, "old.pdf"), "x");

            expect(() =>
                validateDestPath(join(realOut, "escape", "old.pdf"), realOut)
            ).toThrow("Path traversal detected");
        });

        it("rejects a new file in a new sub-folder behind the link", () => {
            linkDir(outside, join(realOut, "escape"));

            expect(() =>
                validateDestPath(
                    join(realOut, "escape", "sub", "new.pdf"),
                    realOut
                )
            ).toThrow("Path traversal detected");
        });

        it("rejects a destination that is a link to a missing target", () => {
            const gone = join(root, "gone");
            mkdirSync(gone);
            linkDir(gone, join(realOut, "dangling"));
            rmSync(gone, { recursive: true });

            expect(() =>
                validateDestPath(join(realOut, "dangling"), realOut)
            ).toThrow("Path traversal detected");
        });

        it("allows a link that stays inside the output directory", () => {
            mkdirSync(join(realOut, "sub"));
            linkDir(join(realOut, "sub"), join(realOut, "alias"));

            expect(() =>
                validateDestPath(join(realOut, "alias", "new.pdf"), realOut)
            ).not.toThrow();
        });
    });

    describe("containment without links", () => {
        it("allows a file name that merely begins with two dots", () => {
            expect(() =>
                validateDestPath(join(realOut, "..notes.pdf"), realOut)
            ).not.toThrow();
            expect(() =>
                validateDestPath(join(realOut, "...pdf"), realOut)
            ).not.toThrow();
        });

        it("rejects the parent directory and its children", () => {
            expect(() =>
                validateDestPath(join(realOut, "..", "a.pdf"), realOut)
            ).toThrow("Path traversal detected");
            expect(() => validateDestPath(root, realOut)).toThrow(
                "Path traversal detected"
            );
        });

        it("rejects a sibling directory that shares the name as a prefix", () => {
            mkdirSync(join(root, "real-out-2"));

            expect(() =>
                validateDestPath(join(root, "real-out-2", "a.pdf"), realOut)
            ).toThrow("Path traversal detected");
        });

        it("rejects the output directory itself as the destination file", () => {
            expect(() => validateDestPath(realOut, realOut)).toThrow(
                "Path traversal detected"
            );
        });

        it("allows a file in an output directory that does not exist yet", () => {
            const fresh = join(root, "not", "created", "yet");

            expect(() =>
                validateDestPath(join(fresh, "a.pdf"), fresh)
            ).not.toThrow();
            expect(() =>
                validateDestPath(join(fresh, "..", "a.pdf"), fresh)
            ).toThrow("Path traversal detected");
        });
    });
});
