import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadFile } from "@/commands/lib/download-utils";

// The temporary file name is random; tests that need to know it fix it here.
const fixedRandom = vi.hoisted(() => ({ hex: null as string | null }));
vi.mock("node:crypto", async (importOriginal) => {
    const original = await importOriginal<typeof import("node:crypto")>();
    return {
        ...original,
        randomBytes: (size: number): Buffer =>
            fixedRandom.hex === null
                ? original.randomBytes(size)
                : Buffer.from(fixedRandom.hex, "hex"),
    };
});

// Every host in these tests resolves to a public address, so the SSRF check
// never gets in the way of what is being tested (and no real DNS is used).
vi.mock("node:dns/promises", () => ({
    lookup: vi.fn<() => Promise<Array<{ address: string; family: number }>>>(
        () => Promise.resolve([{ address: "203.0.113.10", family: 4 }])
    ),
}));

const ORIGIN = "https://ecampus.kangnam.ac.kr";
const FILE_URL = `${ORIGIN}/pluginfile.php/1/mod_ubfile/content/0/a.pdf`;
const SESSION = "s3ss10n";

type Route = (url: URL) => Response;

/** Requests actually sent: URL and the Cookie header that went with it. */
let sent: Array<{ url: string; cookie: string | null }>;
let dir: string;

function stubFetch(route: Route): void {
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>((input, init) => {
            const url = new URL(
                input instanceof Request ? input.url : input.toString()
            );
            sent.push({
                url: url.toString(),
                cookie: new Headers(init?.headers).get("cookie"),
            });
            return Promise.resolve(route(url));
        })
    );
}

function redirect(location: string, status = 302): Response {
    return new Response(null, { status, headers: { Location: location } });
}

describe("downloadFile session cookie scope", () => {
    beforeEach(() => {
        sent = [];
        dir = mkdtempSync(join(tmpdir(), "kampus-download-"));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        rmSync(dir, { recursive: true, force: true });
    });

    it("sends the cookie to the e-campus origin over https", async () => {
        stubFetch(() => new Response("PDF"));
        const dest = join(dir, "a.pdf");

        await downloadFile(FILE_URL, dest, SESSION, { allowedDir: dir });

        expect(sent).toEqual([
            { url: FILE_URL, cookie: `MoodleSession=${SESSION}` },
        ]);
        expect(readFileSync(dest, "utf8")).toBe("PDF");
    });

    it("does not send the cookie to an off-origin URL", async () => {
        stubFetch(() => new Response("PDF"));
        const url = "https://files.example.com/pluginfile.php/1/a.pdf";

        await downloadFile(url, join(dir, "a.pdf"), SESSION, {
            allowedDir: dir,
        });

        expect(sent).toEqual([{ url, cookie: null }]);
    });

    it.each([
        "https://ecampus.kangnam.ac.kr.example.com/pluginfile.php/1/a.pdf",
        "https://ecampus.kangnam.ac.kr:8443/pluginfile.php/1/a.pdf",
        "https://sub.ecampus.kangnam.ac.kr/pluginfile.php/1/a.pdf",
    ])("does not send the cookie to the look-alike %s", async (url) => {
        stubFetch(() => new Response("PDF"));

        await downloadFile(url, join(dir, "a.pdf"), SESSION, {
            allowedDir: dir,
        });

        expect(sent.map((r) => r.cookie)).toEqual([null]);
    });

    it("does not send the cookie over plain http, even to the e-campus host", async () => {
        stubFetch(() => new Response("PDF"));
        const url = FILE_URL.replace("https:", "http:");

        await downloadFile(url, join(dir, "a.pdf"), SESSION, {
            allowedDir: dir,
        });

        expect(sent).toEqual([{ url, cookie: null }]);
    });

    it("drops the cookie when an on-origin URL redirects off-origin", async () => {
        const offOrigin = "https://storage.example.net/bucket/a.pdf?sig=1";
        stubFetch((url) =>
            url.origin === ORIGIN ? redirect(offOrigin) : new Response("PDF")
        );
        const dest = join(dir, "a.pdf");

        await downloadFile(FILE_URL, dest, SESSION, { allowedDir: dir });

        expect(sent).toEqual([
            { url: FILE_URL, cookie: `MoodleSession=${SESSION}` },
            { url: offOrigin, cookie: null },
        ]);
        expect(readFileSync(dest, "utf8")).toBe("PDF");
    });

    it.each([301, 302, 303, 307, 308])(
        "drops the cookie on a %i redirect to another host",
        async (status) => {
            stubFetch((url) =>
                url.origin === ORIGIN
                    ? redirect("https://evil.example.org/collect", status)
                    : new Response("x")
            );

            await downloadFile(FILE_URL, join(dir, "a.pdf"), SESSION, {
                allowedDir: dir,
            });

            expect(sent[1]).toEqual({
                url: "https://evil.example.org/collect",
                cookie: null,
            });
        }
    );

    it("drops the cookie when a redirect downgrades to http on the same host", async () => {
        const downgraded = FILE_URL.replace("https:", "http:");
        stubFetch((url) =>
            url.protocol === "https:"
                ? redirect(downgraded)
                : new Response("PDF")
        );

        await downloadFile(FILE_URL, join(dir, "a.pdf"), SESSION, {
            allowedDir: dir,
        });

        expect(sent.map((r) => r.cookie)).toEqual([
            `MoodleSession=${SESSION}`,
            null,
        ]);
    });

    it("keeps the cookie across a redirect that stays on the origin", async () => {
        const second = `${ORIGIN}/pluginfile.php/1/mod_ubfile/content/1/a.pdf`;
        stubFetch((url) =>
            url.toString() === FILE_URL ? redirect(second) : new Response("PDF")
        );

        await downloadFile(FILE_URL, join(dir, "a.pdf"), SESSION, {
            allowedDir: dir,
        });

        expect(sent.map((r) => r.cookie)).toEqual([
            `MoodleSession=${SESSION}`,
            `MoodleSession=${SESSION}`,
        ]);
    });

    it("fails instead of saving the login page when redirected to login", async () => {
        stubFetch((url) =>
            url.pathname.startsWith("/login/")
                ? new Response("<html>login</html>")
                : redirect(`${ORIGIN}/login/index.php`, 303)
        );
        const dest = join(dir, "a.pdf");

        await expect(
            downloadFile(FILE_URL, dest, SESSION, { allowedDir: dir })
        ).rejects.toThrow("Login required");

        expect(sent).toHaveLength(1);
        expect(existsSync(dest)).toBe(false);
    });

    it("refuses a redirect to a non-http(s) scheme", async () => {
        stubFetch(() => redirect("file:///etc/passwd"));

        await expect(
            downloadFile(FILE_URL, join(dir, "a.pdf"), SESSION, {
                allowedDir: dir,
            })
        ).rejects.toThrow("Unsupported protocol");
        expect(sent).toHaveLength(1);
    });
});

/**
 * Real files in a real temp directory: what is on disk before, during and
 * after a download.
 */
describe("downloadFile writes through a temporary file", () => {
    let root: string;
    let out: string;
    let outside: string;

    function linkDir(target: string, path: string): void {
        symlinkSync(
            target,
            path,
            process.platform === "win32" ? "junction" : "dir"
        );
    }

    /** A body that delivers `first`, then fails. */
    function brokenBody(first: string): ReadableStream<Uint8Array> {
        let sentFirst = false;
        return new ReadableStream<Uint8Array>({
            pull(controller) {
                if (!sentFirst) {
                    sentFirst = true;
                    controller.enqueue(new TextEncoder().encode(first));
                    return;
                }
                controller.error(new Error("connection reset"));
            },
        });
    }

    beforeEach(() => {
        sent = [];
        fixedRandom.hex = null;
        root = realpathSync(mkdtempSync(join(tmpdir(), "kampus-atomic-")));
        out = join(root, "out");
        outside = join(root, "outside");
        mkdirSync(out);
        mkdirSync(outside);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        rmSync(root, { recursive: true, force: true });
    });

    it("replaces an existing copy on a successful re-download and leaves nothing else", async () => {
        const dest = join(out, "a.pdf");
        stubFetch(() => new Response("first"));
        await downloadFile(FILE_URL, dest, SESSION, { allowedDir: out });
        stubFetch(() => new Response("second, longer"));
        await downloadFile(FILE_URL, dest, SESSION, { allowedDir: out });

        expect(readFileSync(dest, "utf8")).toBe("second, longer");
        expect(readdirSync(out)).toEqual(["a.pdf"]);
    });

    it("keeps the previous copy when the re-download answers with an error status", async () => {
        const dest = join(out, "a.pdf");
        writeFileSync(dest, "good copy");
        stubFetch(() => new Response("nope", { status: 500 }));

        await expect(
            downloadFile(FILE_URL, dest, SESSION, { allowedDir: out })
        ).rejects.toThrow("HTTP 500");

        expect(readFileSync(dest, "utf8")).toBe("good copy");
        expect(readdirSync(out)).toEqual(["a.pdf"]);
    });

    it("keeps the previous copy when the body breaks off half way", async () => {
        const dest = join(out, "a.pdf");
        writeFileSync(dest, "good copy");
        stubFetch(() => new Response(brokenBody("partial")));

        await expect(
            downloadFile(FILE_URL, dest, SESSION, { allowedDir: out })
        ).rejects.toThrow("connection reset");

        // The old file is untouched and the partial one is gone
        expect(readFileSync(dest, "utf8")).toBe("good copy");
        expect(readdirSync(out)).toEqual(["a.pdf"]);
    });

    it("leaves no file at all when a first download breaks off", async () => {
        stubFetch(() => new Response(brokenBody("partial")));

        await expect(
            downloadFile(FILE_URL, join(out, "a.pdf"), SESSION, {
                allowedDir: out,
            })
        ).rejects.toThrow("connection reset");

        expect(readdirSync(out)).toEqual([]);
    });

    it("keeps the previous copy when the session has expired", async () => {
        const dest = join(out, "a.pdf");
        writeFileSync(dest, "good copy");
        stubFetch(() => redirect(`${ORIGIN}/login/index.php`, 303));

        await expect(
            downloadFile(FILE_URL, dest, SESSION, { allowedDir: out })
        ).rejects.toThrow("Login required");

        expect(readFileSync(dest, "utf8")).toBe("good copy");
    });

    it("creates the temporary file exclusively: a file planted at its path is not written to", async () => {
        fixedRandom.hex = "00112233445566ff";
        const planted = join(out, ".kampus-00112233445566ff.part");
        writeFileSync(planted, "planted");
        stubFetch(() => new Response("PDF"));

        await expect(
            downloadFile(FILE_URL, join(out, "a.pdf"), SESSION, {
                allowedDir: out,
            })
        ).rejects.toThrow(/EEXIST/);

        // Not overwritten, not removed, and no download took its place
        expect(readFileSync(planted, "utf8")).toBe("planted");
        expect(existsSync(join(out, "a.pdf"))).toBe(false);
    });

    it.each([
        // Caught by the path check: the link leads out of the folder
        ["outside the folder", "outside", /Path traversal detected/],
        // Passes the path check, so only the exclusive open stops it
        ["inside the folder", "inside", /EEXIST/],
    ] as const)(
        "does not write through a link planted at the temporary file's path, to a file %s",
        async (_label, where, expected) => {
            fixedRandom.hex = "00112233445566ff";
            const victim = join(
                where === "outside" ? outside : out,
                "victim.txt"
            );
            writeFileSync(victim, "victim");
            let linked = true;
            try {
                symlinkSync(victim, join(out, ".kampus-00112233445566ff.part"));
            } catch {
                // File symlinks need a privilege on Windows
                linked = false;
            }
            if (!linked) return;
            stubFetch(() => new Response("PDF"));

            await expect(
                downloadFile(FILE_URL, join(out, "a.pdf"), SESSION, {
                    allowedDir: out,
                })
            ).rejects.toThrow(expected);

            expect(readFileSync(victim, "utf8")).toBe("victim");
            expect(existsSync(join(out, "a.pdf"))).toBe(false);
        }
    );

    it("refuses to write when the output folder is swapped for a link during the request", async () => {
        const dest = join(out, "a.pdf");
        // The check before the request passes; while the request is under
        // way the folder is replaced by a link to another place.
        stubFetch(() => {
            renameSync(out, join(root, "out-moved"));
            linkDir(outside, out);
            return new Response("PDF");
        });

        await expect(
            downloadFile(FILE_URL, dest, SESSION, { allowedDir: out })
        ).rejects.toThrow("Path traversal detected");

        expect(readdirSync(outside)).toEqual([]);
        expect(readdirSync(join(root, "out-moved"))).toEqual([]);
    });

    it("refuses to write when a sub-folder of the output folder is swapped for a link during the request", async () => {
        const sub = join(out, "week1");
        mkdirSync(sub);
        stubFetch(() => {
            renameSync(sub, join(out, "week1-moved"));
            linkDir(outside, sub);
            return new Response("PDF");
        });

        await expect(
            downloadFile(FILE_URL, join(sub, "a.pdf"), SESSION, {
                allowedDir: out,
            })
        ).rejects.toThrow("Path traversal detected");

        expect(readdirSync(outside)).toEqual([]);
    });

    it("still downloads into an output folder that is a link from the start", async () => {
        const link = join(root, "out-link");
        linkDir(out, link);
        stubFetch(() => new Response("PDF"));

        await downloadFile(FILE_URL, join(link, "a.pdf"), SESSION, {
            allowedDir: link,
        });
        // ...and again, now that the file exists
        await downloadFile(FILE_URL, join(link, "a.pdf"), SESSION, {
            allowedDir: link,
        });

        expect(readFileSync(join(out, "a.pdf"), "utf8")).toBe("PDF");
        expect(readdirSync(out)).toEqual(["a.pdf"]);
    });
});

describe("downloadFile does not save a web page as the file", () => {
    let pageDir: string;
    const VIEW_URL = `${ORIGIN}/mod/ubfile/view.php?id=10`;

    function htmlPage(headers: Record<string, string> = {}): Response {
        return new Response("<html><body>page</body></html>", {
            headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
        });
    }

    beforeEach(() => {
        sent = [];
        fixedRandom.hex = null;
        pageDir = mkdtempSync(join(tmpdir(), "kampus-html-"));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        rmSync(pageDir, { recursive: true, force: true });
    });

    it.each([
        ["a login page answered with 200", `${ORIGIN}/login/index.php`],
        ["an error page of the view URL", VIEW_URL],
        ["the course page", `${ORIGIN}/course/view.php?id=1`],
        [
            "a script that only has pluginfile.php in its path",
            `${ORIGIN}/mod/url/view.php/pluginfile.php?id=9`,
        ],
    ])("refuses %s", async (_label, url) => {
        stubFetch(() => htmlPage());
        const dest = join(pageDir, "a.pdf");

        await expect(
            downloadFile(url, dest, SESSION, { allowedDir: pageDir })
        ).rejects.toThrow(/web page instead of a file|Login required/);

        expect(readdirSync(pageDir)).toEqual([]);
    });

    it("refuses a page reached through a redirect, e.g. a notice page", async () => {
        stubFetch((url) =>
            url.pathname.startsWith("/pluginfile.php")
                ? redirect(`${ORIGIN}/mod/ubfile/notice.php`)
                : htmlPage()
        );

        await expect(
            downloadFile(FILE_URL, join(pageDir, "a.pdf"), SESSION, {
                allowedDir: pageDir,
            })
        ).rejects.toThrow("web page instead of a file");
        expect(readdirSync(pageDir)).toEqual([]);
    });

    it("refuses application/xhtml+xml the same way", async () => {
        stubFetch(
            () =>
                new Response("<html/>", {
                    headers: { "Content-Type": "application/xhtml+xml" },
                })
        );

        await expect(
            downloadFile(VIEW_URL, join(pageDir, "a.pdf"), SESSION, {
                allowedDir: pageDir,
            })
        ).rejects.toThrow("web page instead of a file");
    });

    it.each([
        `${ORIGIN}//login/index.php`,
        `${ORIGIN}/login/index.php`,
        "//ecampus.kangnam.ac.kr//login/index.php",
    ])("treats a redirect to %s as a login redirect", async (location) => {
        stubFetch((url) =>
            url.pathname.startsWith("/pluginfile.php")
                ? redirect(location, 303)
                : htmlPage()
        );

        await expect(
            downloadFile(FILE_URL, join(pageDir, "a.pdf"), SESSION, {
                allowedDir: pageDir,
            })
        ).rejects.toThrow("Login required");
        expect(sent).toHaveLength(1);
        expect(readdirSync(pageDir)).toEqual([]);
    });

    it("does not take a file whose path contains /login/ for the login page", async () => {
        const file = `${ORIGIN}/pluginfile.php/55/mod_resource/content/1/login/notes.pdf`;
        stubFetch((url) =>
            url.toString() === FILE_URL ? redirect(file) : new Response("PDF")
        );
        const dest = join(pageDir, "notes.pdf");

        await downloadFile(FILE_URL, dest, SESSION, { allowedDir: pageDir });

        expect(readFileSync(dest, "utf8")).toBe("PDF");
    });

    it("saves an HTML attachment served by pluginfile.php", async () => {
        stubFetch(() => htmlPage());
        const dest = join(pageDir, "notes.html");

        await downloadFile(
            `${ORIGIN}/pluginfile.php/1/mod_ubfile/content/0/notes.html`,
            dest,
            SESSION,
            { allowedDir: pageDir }
        );

        expect(readFileSync(dest, "utf8")).toContain("page");
    });

    it("saves an HTML file the view URL serves with Content-Disposition", async () => {
        stubFetch(() =>
            htmlPage({
                "Content-Disposition": 'attachment; filename="notes.html"',
            })
        );
        const dest = join(pageDir, "notes.html");

        await downloadFile(VIEW_URL, dest, SESSION, { allowedDir: pageDir });

        expect(readFileSync(dest, "utf8")).toContain("page");
    });

    it("leaves HTML from another host alone (it never saw the session)", async () => {
        stubFetch(() => htmlPage());
        const dest = join(pageDir, "page.html");

        await downloadFile("https://files.example.com/a", dest, SESSION, {
            allowedDir: pageDir,
        });

        expect(readFileSync(dest, "utf8")).toContain("page");
    });
});
