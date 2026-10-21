import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    onTestFinished,
    vi,
} from "vitest";
import { Crawler } from "@/crawler";
import { fetchWithBase } from "@/client";
import { login } from "@/auth";
import type { LogObject } from "consola";
import { getLogger, setLogLevel } from "@/logger";
import { MemoryStorage } from "@/storage/memory";
import { isEcampusUrl, isLoginUrl, isPluginfileUrl } from "@/url";

/**
 * These tests run the real client (`@/client` is not mocked) against a
 * stubbed global `fetch`, and look at every request that was actually
 * issued: where it went and what it carried.
 */

const ORIGIN = "https://ecampus.kangnam.ac.kr";
const SESSION = "MoodleSession=s3cr3tsessionvalue";

interface Sent {
    url: string;
    method: string;
    cookie: string | null;
    body: string | null;
    redirect: string | undefined;
}

type Route = (url: URL, sent: Sent) => Response;

let sent: Sent[];

function stubFetch(route: Route): void {
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>((input, init) => {
            const url = new URL(
                input instanceof Request ? input.url : input.toString()
            );
            const request: Sent = {
                url: url.toString(),
                method: init?.method ?? "GET",
                cookie: new Headers(init?.headers).get("cookie"),
                body:
                    init?.body instanceof URLSearchParams
                        ? init.body.toString()
                        : null,
                redirect: init?.redirect,
            };
            sent.push(request);
            return Promise.resolve(route(url, request));
        })
    );
}

function redirect(location: string, status = 303): Response {
    return new Response(null, { status, headers: { Location: location } });
}

function html(body: string, status = 200): Response {
    return new Response(body, {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
}

/** Every request went to the https e-campus origin, and nowhere else. */
function expectOnlyEcampusRequests(): void {
    for (const request of sent) {
        const url = new URL(request.url);
        expect(url.protocol).toBe("https:");
        expect(url.host).toBe("ecampus.kangnam.ac.kr");
    }
}

describe("requests of the crawler never leave the e-campus origin", () => {
    let crawler: Crawler;

    beforeEach(async () => {
        sent = [];
        crawler = new Crawler({ storage: new MemoryStorage() });
        await crawler.setSession(SESSION);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        setLogLevel("silent");
    });

    describe("redirect Location values that name another host", () => {
        it.each([
            ["protocol-relative", "//evil.example/steal"],
            ["backslash", "/\\evil.example/steal"],
            ["absolute", "https://evil.example//evil.example/steal"],
            ["absolute, plain", "https://evil.example/steal"],
            ["http downgrade", "http://ecampus.kangnam.ac.kr/steal"],
            ["other port", "https://ecampus.kangnam.ac.kr:8443/steal"],
        ])("refuses a 303 to a %s target (%s)", async (_label, location) => {
            stubFetch((url) =>
                url.pathname === "/start"
                    ? redirect(location)
                    : html("should never be requested")
            );

            await expect(crawler.fetch("/start")).rejects.toThrow(
                "Refusing to follow a redirect outside"
            );

            // The one request that was issued, and nothing after it
            expect(sent).toEqual([
                {
                    url: `${ORIGIN}/start`,
                    method: "GET",
                    cookie: SESSION,
                    body: null,
                    redirect: "manual",
                },
            ]);
        });

        it("keeps an on-origin Location with a double-slash path on the e-campus", async () => {
            // The path is `//evil.example/steal`; the host is still ours.
            // Reducing it to a path and resolving that again is what used to
            // turn it into a request to evil.example.
            stubFetch((url) =>
                url.pathname === "/start"
                    ? redirect(`${ORIGIN}//evil.example/steal`)
                    : html("page")
            );

            const response = await crawler.fetch("/start");

            expect(response.status).toBe(200);
            expect(sent.map((r) => [r.url, r.cookie])).toEqual([
                [`${ORIGIN}/start`, SESSION],
                [`${ORIGIN}//evil.example/steal`, SESSION],
            ]);
            expectOnlyEcampusRequests();
        });

        it.each([301, 302, 303, 307, 308])(
            "refuses a %i to another host",
            async (status) => {
                stubFetch((url) =>
                    url.pathname === "/start"
                        ? redirect("https://evil.example/steal", status)
                        : html("no")
                );

                await expect(crawler.fetch("/start")).rejects.toThrow(
                    "evil.example"
                );
                expect(sent).toHaveLength(1);
                expectOnlyEcampusRequests();
            }
        );

        it("refuses an off-origin hop in the middle of a chain", async () => {
            stubFetch((url) => {
                if (url.pathname === "/a") return redirect("/b");
                if (url.pathname === "/b") return redirect("//evil.example/c");
                return html("no");
            });

            await expect(crawler.fetch("/a")).rejects.toThrow("evil.example");
            expect(sent.map((r) => r.url)).toEqual([
                `${ORIGIN}/a`,
                `${ORIGIN}/b`,
            ]);
        });

        it("resolves a relative Location against the redirecting URL", async () => {
            stubFetch((url) =>
                url.pathname === "/mod/quiz/view.php"
                    ? redirect("../../course/view.php?id=7")
                    : html("course")
            );

            await crawler.fetch("/mod/quiz/view.php?id=1");

            expect(sent.map((r) => r.url)).toEqual([
                `${ORIGIN}/mod/quiz/view.php?id=1`,
                `${ORIGIN}/course/view.php?id=7`,
            ]);
        });
    });

    describe("request URLs that name another host", () => {
        it.each([
            "//evil.example/x",
            "/\\evil.example/x",
            "\\\\evil.example/x",
            "https://evil.example/x",
            "http://ecampus.kangnam.ac.kr/x",
            "https://ecampus.kangnam.ac.kr.evil.example/x",
            "https://ecampus.kangnam.ac.kr@evil.example/x",
            "javascript:alert(1)",
            "file:///etc/passwd",
        ])("Crawler.fetch(%j) sends nothing", async (url) => {
            stubFetch(() => html("no"));

            await expect(crawler.fetch(url)).rejects.toThrow(
                "Refusing to send a request outside"
            );
            expect(sent).toEqual([]);
        });

        it.each([
            "//evil.example/x",
            "/\\evil.example/x",
            "https://evil.example/x",
            "http://ecampus.kangnam.ac.kr/x",
            "blob:https://ecampus.kangnam.ac.kr/3f2c",
        ])("fetchWithBase(%j) sends nothing", async (url) => {
            stubFetch(() => html("no"));

            await expect(
                fetchWithBase(url, { headers: { Cookie: SESSION } })
            ).rejects.toThrow("Refusing to send a request outside");
            expect(sent).toEqual([]);
        });

        it("accepts a path and an absolute URL of the e-campus", async () => {
            stubFetch(() => html("ok"));

            await crawler.fetch("/course/view.php?id=1");
            await crawler.fetch("course/view.php?id=2");
            await crawler.fetch(`${ORIGIN}/course/view.php?id=3`);

            expect(sent.map((r) => [r.url, r.cookie])).toEqual([
                [`${ORIGIN}/course/view.php?id=1`, SESSION],
                [`${ORIGIN}/course/view.php?id=2`, SESSION],
                [`${ORIGIN}/course/view.php?id=3`, SESSION],
            ]);
        });

        it("never lets fetch follow redirects by itself", async () => {
            stubFetch(() => html("ok"));

            await fetchWithBase("/x", { redirect: "follow" });

            expect(sent[0]?.redirect).toBe("manual");
        });
    });

    describe("stored credentials", () => {
        it("are posted to the e-campus login page only", async () => {
            stubFetch(
                () =>
                    new Response("", {
                        status: 303,
                        headers: { "Set-Cookie": "MoodleSession=fresh" },
                    })
            );

            await login("student", "hunter2");

            expect(sent).toEqual([
                {
                    url: `${ORIGIN}/login/index.php`,
                    method: "POST",
                    cookie: null,
                    body: "username=student&password=hunter2",
                    redirect: "manual",
                },
            ]);
        });

        it("are not re-sent when a file path merely contains /login/", async () => {
            await crawler.saveCredentials("student", "hunter2");
            const file = `${ORIGIN}/pluginfile.php/55/mod_resource/content/1/login/notes.pdf`;
            stubFetch((url) =>
                url.pathname === "/mod/resource/view.php"
                    ? redirect(file)
                    : new Response("PDF")
            );

            const response = await crawler.fetch(
                "/mod/resource/view.php?id=55"
            );

            expect(await response.text()).toBe("PDF");
            // No login request, no credentials on the wire
            expect(sent.map((r) => [r.method, r.url, r.body])).toEqual([
                ["GET", `${ORIGIN}/mod/resource/view.php?id=55`, null],
                ["GET", file, null],
            ]);
        });

        it("are not sent to a login page of another host", async () => {
            await crawler.saveCredentials("student", "hunter2");
            stubFetch((url) =>
                url.pathname === "/start"
                    ? redirect("https://evil.example/login/index.php")
                    : html("no")
            );

            await expect(crawler.fetch("/start")).rejects.toThrow(
                "evil.example"
            );
            expect(sent).toHaveLength(1);
            expect(sent[0]?.body).toBeNull();
        });
    });

    describe("login redirects", () => {
        it.each([
            `${ORIGIN}/login/index.php`,
            "/login/index.php",
            "//ecampus.kangnam.ac.kr/login/index.php",
            `${ORIGIN}//login/index.php`,
            `${ORIGIN}/login/`,
        ])("treats a 303 to %s as an expired session", async (location) => {
            stubFetch(() => redirect(location));

            await expect(crawler.fetch("/my/")).rejects.toThrow(
                "Session expired and no stored credentials"
            );
            expect(sent).toHaveLength(1);
        });

        it.each([301, 302, 303, 307, 308])(
            "treats a %i to the login page as an expired session",
            async (status) => {
                stubFetch(() => redirect(`${ORIGIN}/login/index.php`, status));

                await expect(crawler.fetch("/my/")).rejects.toThrow(
                    "Session expired"
                );
            }
        );

        it("reports an expired session to a caller that does not follow redirects", async () => {
            stubFetch(() => redirect(`${ORIGIN}/login/index.php`, 302));

            // getResourceDetail inspects redirects itself
            await expect(crawler.getResourceDetail("479444")).rejects.toThrow(
                "Session expired and no stored credentials"
            );
        });

        it("logs in again and repeats the request when a 302 leads to the login page", async () => {
            await crawler.saveCredentials("student", "hunter2");
            let loggedIn = false;
            stubFetch((url, request) => {
                if (request.method === "POST") {
                    loggedIn = true;
                    return new Response("", {
                        status: 303,
                        headers: { "Set-Cookie": "MoodleSession=fresh" },
                    });
                }
                if (url.pathname === "/")
                    return html('<a href="/login/logout.php">logout</a>');
                return loggedIn
                    ? html("the page")
                    : redirect(`${ORIGIN}/login/index.php`, 302);
            });

            const response = await crawler.fetch("/my/");

            expect(await response.text()).toBe("the page");
            expect(sent.map((r) => [r.method, r.url, r.cookie])).toEqual([
                ["GET", `${ORIGIN}/my/`, SESSION],
                ["POST", `${ORIGIN}/login/index.php`, null],
                ["GET", `${ORIGIN}/`, "MoodleSession=fresh"],
                ["GET", `${ORIGIN}/my/`, "MoodleSession=fresh"],
            ]);
            expectOnlyEcampusRequests();
        });

        it("logs in at most once when the page keeps asking for a login", async () => {
            await crawler.saveCredentials("student", "hunter2");
            stubFetch((url, request) => {
                if (request.method === "POST") {
                    return new Response("", {
                        status: 303,
                        headers: { "Set-Cookie": "MoodleSession=fresh" },
                    });
                }
                if (url.pathname === "/")
                    return html('<a href="/login/logout.php">logout</a>');
                return redirect(`${ORIGIN}/login/index.php`);
            });

            await expect(crawler.fetch("/stubborn")).rejects.toThrow(
                "again right after logging in"
            );
            expect(sent.filter((r) => r.method === "POST")).toHaveLength(1);
        });
    });

    describe("redirect following", () => {
        it("stops after 10 hops instead of looping forever", async () => {
            stubFetch(() => redirect("/a"));

            await expect(crawler.fetch("/a")).rejects.toThrow(
                "Too many redirects (>10)"
            );
            // The first request plus ten followed hops
            expect(sent).toHaveLength(11);
        });

        it("follows a chain of exactly 10 hops", async () => {
            stubFetch((url) => {
                const n = Number(url.searchParams.get("n") ?? "0");
                return n < 10 ? redirect(`/hop?n=${n + 1}`) : html("end");
            });

            const response = await crawler.fetch("/hop?n=0");

            expect(await response.text()).toBe("end");
            expect(sent).toHaveLength(11);
        });

        it("turns a POST into a GET without the body on a 303", async () => {
            stubFetch((url) =>
                url.pathname === "/form" ? redirect("/done") : html("done")
            );

            await crawler.fetch("/form", {
                method: "POST",
                body: new URLSearchParams({ a: "1" }),
            });

            expect(sent.map((r) => [r.method, r.url, r.body])).toEqual([
                ["POST", `${ORIGIN}/form`, "a=1"],
                ["GET", `${ORIGIN}/done`, null],
            ]);
        });

        it("repeats a POST with its body on a 307", async () => {
            stubFetch((url) =>
                url.pathname === "/form" ? redirect("/form2", 307) : html("ok")
            );

            await crawler.fetch("/form", {
                method: "POST",
                body: new URLSearchParams({ a: "1" }),
            });

            expect(sent.map((r) => [r.method, r.body])).toEqual([
                ["POST", "a=1"],
                ["POST", "a=1"],
            ]);
        });

        it("returns a redirect without a Location header as it is", async () => {
            stubFetch(() => new Response("", { status: 302 }));

            const response = await crawler.fetch("/odd");

            expect(response.status).toBe(302);
            expect(sent).toHaveLength(1);
        });
    });

    describe("trace logging", () => {
        it("masks the session in Set-Cookie response headers and in the request cookie", async () => {
            // What any reporter of the library's logger receives
            const lines: string[] = [];
            const reporter = {
                log: (logObj: LogObject): void => {
                    lines.push(
                        logObj.args
                            .map((arg: unknown) =>
                                typeof arg === "string"
                                    ? arg
                                    : JSON.stringify(arg)
                            )
                            .join(" ")
                    );
                },
            };
            getLogger().addReporter(reporter);
            onTestFinished(() => {
                getLogger().removeReporter(reporter);
            });
            // consola's numeric level of `trace`, set directly: this test is
            // about what a trace line contains once it is emitted.
            getLogger().level = 5;
            stubFetch(
                () =>
                    new Response("ok", {
                        headers: [
                            [
                                "Set-Cookie",
                                "MoodleSession=n3wsessionvalue; path=/; secure",
                            ],
                            ["Set-Cookie", "MOODLEID1_=deleted; path=/"],
                            ["X-Other", "kept"],
                        ],
                    })
            );

            await crawler.fetch("/my/");

            const output = lines.join("\n");
            expect(output).toContain("MoodleSession=***");
            expect(output).toContain("MOODLEID1_=***");
            expect(output).toContain('"x-other":"kept"');
            expect(output).not.toContain("n3wsessionvalue");
            expect(output).not.toContain("s3cr3tsessionvalue");
        });
    });
});

describe("URL classification", () => {
    it("isEcampusUrl requires https, not just the origin", () => {
        expect(isEcampusUrl(`${ORIGIN}/a`)).toBe(true);
        // URL.origin of a blob URL is the origin of the inner URL
        expect(isEcampusUrl(`blob:${ORIGIN}/3f2c-11`)).toBe(false);
        expect(isEcampusUrl("http://ecampus.kangnam.ac.kr/a")).toBe(false);
        expect(isEcampusUrl("not a url")).toBe(false);
    });

    it("isLoginUrl reads the parsed path of an on-origin URL", () => {
        expect(isLoginUrl(`${ORIGIN}/login/index.php`)).toBe(true);
        expect(isLoginUrl(`${ORIGIN}/login/index.php?x=1`)).toBe(true);
        expect(isLoginUrl(`${ORIGIN}//login/index.php`)).toBe(true);
        expect(isLoginUrl(`${ORIGIN}/login/`)).toBe(true);

        expect(
            isLoginUrl(
                `${ORIGIN}/pluginfile.php/55/mod_resource/content/1/login/notes.pdf`
            )
        ).toBe(false);
        expect(isLoginUrl(`${ORIGIN}/mod/quiz/view.php?next=/login/`)).toBe(
            false
        );
        expect(isLoginUrl(`${ORIGIN}/loginhelp.php`)).toBe(false);
        expect(isLoginUrl("https://evil.example/login/index.php")).toBe(false);
    });

    it("isPluginfileUrl requires the pluginfile script itself", () => {
        expect(
            isPluginfileUrl(`${ORIGIN}/pluginfile.php/1/mod_x/content/0/a.pdf`)
        ).toBe(true);
        expect(
            isPluginfileUrl(
                `${ORIGIN}/pluginfile.php?file=%2F1%2Fmod_x%2Fcontent%2F0%2Fa.pdf`
            )
        ).toBe(true);

        expect(
            isPluginfileUrl(`${ORIGIN}/mod/url/view.php/pluginfile.php?id=9`)
        ).toBe(false);
        expect(isPluginfileUrl(`${ORIGIN}/pluginfile.php`)).toBe(false);
        expect(isPluginfileUrl(`${ORIGIN}/pluginfile.php/`)).toBe(false);
        expect(isPluginfileUrl(`${ORIGIN}/pluginfile.phpx/1/a.pdf`)).toBe(
            false
        );
        expect(isPluginfileUrl(`${ORIGIN}/x?u=/pluginfile.php/1/a.pdf`)).toBe(
            false
        );
        expect(
            isPluginfileUrl("https://evil.example/pluginfile.php/1/a.pdf")
        ).toBe(false);
    });
});

describe("CrawlerOptions.baseUrl", () => {
    beforeEach(() => {
        sent = [];
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("sends requests, and the session, to that site only", async () => {
        const crawler = new Crawler({
            storage: new MemoryStorage(),
            baseUrl: "http://localhost:8080",
        });
        await crawler.setSession(SESSION);
        stubFetch((url) =>
            url.pathname === "/a" ? redirect("/b") : html("ok")
        );

        await crawler.fetch("/a");

        expect(sent.map((r) => [r.url, r.cookie])).toEqual([
            ["http://localhost:8080/a", SESSION],
            ["http://localhost:8080/b", SESSION],
        ]);
    });

    it("refuses the real e-campus and any other host from a crawler on another site", async () => {
        const crawler = new Crawler({
            storage: new MemoryStorage(),
            baseUrl: "http://localhost:8080",
        });
        await crawler.setSession(SESSION);
        stubFetch((url) =>
            url.pathname === "/a" ? redirect(`${ORIGIN}/b`) : html("ok")
        );

        await expect(crawler.fetch(`${ORIGIN}/x`)).rejects.toThrow(
            "Refusing to send a request outside http://localhost:8080"
        );
        await expect(crawler.fetch("/a")).rejects.toThrow(
            "Refusing to follow a redirect outside http://localhost:8080"
        );
        expect(sent.map((r) => r.url)).toEqual(["http://localhost:8080/a"]);
    });

    it("returns URLs on that site, including relative file links", async () => {
        const crawler = new Crawler({
            storage: new MemoryStorage(),
            baseUrl: "https://mock.example",
        });
        stubFetch((url) => {
            if (url.pathname === "/mod/ubfile/view.php") {
                return new Response("PDF", {
                    headers: {
                        "Content-Type": "application/pdf",
                        "Content-Disposition": 'attachment; filename="a.pdf"',
                    },
                });
            }
            return html(`<html><body>
                <div role="main"><h2>과제</h2></div>
                <div id="intro">
                    <a href="/pluginfile.php/10/mod_assign/intro/guide.pdf">guide.pdf</a>
                    <a href="${ORIGIN}/pluginfile.php/10/mod_assign/intro/real.pdf">real.pdf</a>
                </div></body></html>`);
        });

        const resource = await crawler.getResourceDetail("5");
        const assignment = await crawler.getAssignmentDetail("6");

        expect(sent.map((r) => r.url)).toEqual([
            "https://mock.example/mod/ubfile/view.php?id=5",
            "https://mock.example/mod/assign/view.php?id=6",
        ]);
        expect(resource.files).toEqual([
            {
                name: "a.pdf",
                url: "https://mock.example/mod/ubfile/view.php?id=5",
            },
        ]);
        // The link to another site (here: the real e-campus) is dropped
        expect(assignment.files).toEqual([
            {
                name: "guide.pdf",
                url: "https://mock.example/pluginfile.php/10/mod_assign/intro/guide.pdf",
            },
        ]);
    });

    it.each([
        "http://mock.example",
        "ftp://mock.example",
        "https://mock.example/moodle",
        "https://user:pw@mock.example",
        "not a url",
    ])("rejects %j", (baseUrl) => {
        expect(() => new Crawler({ baseUrl })).toThrow("Invalid baseUrl");
    });

    it("accepts the e-campus with a trailing slash", () => {
        expect(() => new Crawler({ baseUrl: `${ORIGIN}/` })).not.toThrow();
    });
});
