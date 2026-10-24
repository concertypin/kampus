import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadFile } from "@/commands/lib/download-utils";

// Host names resolve to a public address (no real DNS); IP literals such as
// 127.0.0.1 are checked as they are.
vi.mock("node:dns/promises", () => ({
    lookup: vi.fn<() => Promise<Array<{ address: string; family: number }>>>(
        () => Promise.resolve([{ address: "203.0.113.10", family: 4 }])
    ),
}));

const SESSION = "s3ss10n";
const LOOPBACK_SITE = "http://127.0.0.1:8080";

type Route = (url: URL) => Response;

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

function redirect(location: string): Response {
    return new Response(null, { status: 302, headers: { Location: location } });
}

describe("downloadFile on a configured site", () => {
    beforeEach(() => {
        sent = [];
        dir = mkdtempSync(join(tmpdir(), "kampus-site-"));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        rmSync(dir, { recursive: true, force: true });
    });

    it.each([LOOPBACK_SITE, "http://localhost:8080", "http://[::1]:8080"])(
        "downloads from the loopback site %s and sends the cookie within it",
        async (site) => {
            stubFetch((url) =>
                url.pathname === "/pluginfile.php/1/a.pdf"
                    ? redirect("/pluginfile.php/1/b.pdf")
                    : new Response("PDF")
            );
            const dest = join(dir, "a.pdf");

            await downloadFile(
                `${site}/pluginfile.php/1/a.pdf`,
                dest,
                SESSION,
                {
                    allowedDir: dir,
                    siteOrigin: site,
                }
            );

            expect(sent).toEqual([
                {
                    url: `${site}/pluginfile.php/1/a.pdf`,
                    cookie: `MoodleSession=${SESSION}`,
                },
                {
                    url: `${site}/pluginfile.php/1/b.pdf`,
                    cookie: `MoodleSession=${SESSION}`,
                },
            ]);
            expect(readFileSync(dest, "utf8")).toBe("PDF");
        }
    );

    it("drops the cookie when a redirect leaves the site", async () => {
        stubFetch((url) =>
            url.host === "127.0.0.1:8080"
                ? redirect("https://files.example.com/a.pdf")
                : new Response("PDF")
        );

        await downloadFile(
            `${LOOPBACK_SITE}/pluginfile.php/1/a.pdf`,
            join(dir, "a.pdf"),
            SESSION,
            { allowedDir: dir, siteOrigin: LOOPBACK_SITE }
        );

        expect(sent.map((r) => r.cookie)).toEqual([
            `MoodleSession=${SESSION}`,
            null,
        ]);
    });

    it("does not treat the e-campus as the site when another one is configured", async () => {
        stubFetch(() => new Response("PDF"));
        const url = "https://ecampus.kangnam.ac.kr/pluginfile.php/1/a.pdf";

        await downloadFile(url, join(dir, "a.pdf"), SESSION, {
            allowedDir: dir,
            siteOrigin: LOOPBACK_SITE,
        });

        expect(sent).toEqual([{ url, cookie: null }]);
    });

    it("detects a redirect to the site's login page", async () => {
        stubFetch(() => redirect("/login/index.php"));

        await expect(
            downloadFile(
                `${LOOPBACK_SITE}/pluginfile.php/1/a.pdf`,
                join(dir, "a.pdf"),
                SESSION,
                { allowedDir: dir, siteOrigin: LOOPBACK_SITE }
            )
        ).rejects.toThrow("Login required");
        expect(sent).toHaveLength(1);
    });

    it("refuses a web page from the site that is not a file", async () => {
        stubFetch(
            () =>
                new Response("<html></html>", {
                    headers: { "Content-Type": "text/html; charset=utf-8" },
                })
        );

        await expect(
            downloadFile(`${LOOPBACK_SITE}/my/`, join(dir, "a.html"), SESSION, {
                allowedDir: dir,
                siteOrigin: LOOPBACK_SITE,
            })
        ).rejects.toThrow("web page instead of a file");
    });

    it.each([
        ["another port of the loopback host", "http://127.0.0.1:9090/a.pdf"],
        ["another loopback address", "http://127.0.0.2:8080/a.pdf"],
        ["a private network address", "http://10.0.0.5/a.pdf"],
        ["the metadata address", "http://169.254.169.254/latest"],
    ])("still refuses %s while on a loopback site", async (_name, url) => {
        stubFetch(() => new Response("x"));

        await expect(
            downloadFile(url, join(dir, "a.pdf"), SESSION, {
                allowedDir: dir,
                siteOrigin: LOOPBACK_SITE,
            })
        ).rejects.toThrow("Blocked download to internal host");
        expect(sent).toEqual([]);
    });

    it("still refuses a redirect from the loopback site to an internal host", async () => {
        stubFetch(() => redirect("http://10.0.0.5/a.pdf"));

        await expect(
            downloadFile(
                `${LOOPBACK_SITE}/pluginfile.php/1/a.pdf`,
                join(dir, "a.pdf"),
                SESSION,
                { allowedDir: dir, siteOrigin: LOOPBACK_SITE }
            )
        ).rejects.toThrow("Blocked redirect to internal host");
        expect(sent).toHaveLength(1);
    });

    it("refuses a loopback URL when the site is not loopback", async () => {
        stubFetch(() => new Response("x"));

        await expect(
            downloadFile(
                "http://127.0.0.1:8080/pluginfile.php/1/a.pdf",
                join(dir, "a.pdf"),
                SESSION,
                { allowedDir: dir, siteOrigin: "https://mock.example" }
            )
        ).rejects.toThrow("Blocked download to internal host");
        await expect(
            downloadFile(
                "http://127.0.0.1:8080/pluginfile.php/1/a.pdf",
                join(dir, "a.pdf"),
                SESSION,
                { allowedDir: dir }
            )
        ).rejects.toThrow("Blocked download to internal host");
        expect(sent).toEqual([]);
    });

    it("rejects an invalid site origin", async () => {
        await expect(
            downloadFile("https://a.example/x", join(dir, "a"), SESSION, {
                allowedDir: dir,
                siteOrigin: "http://example.com",
            })
        ).rejects.toThrow("Invalid baseUrl");
    });
});
