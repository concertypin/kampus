import { describe, expect, it, beforeEach, vi } from "vitest";
import { Crawler } from "@/crawler";
import { MemoryStorage } from "@/storage/memory";
import { fetchWithBase } from "@/client";

vi.mock("@/client", () => ({
    fetchWithBase: vi.fn<typeof fetchWithBase>(),
    BASE_URL: "https://ecampus.kangnam.ac.kr",
}));

const mockFetch = vi.mocked(fetchWithBase);

describe("Crawler", () => {
    let crawler: Crawler;
    let storage: MemoryStorage;

    beforeEach(() => {
        storage = new MemoryStorage();
        crawler = new Crawler({ storage });
    });

    describe("session management", () => {
        it("should return undefined when no session exists", async () => {
            const session = await crawler.getSession();
            expect(session).toBeUndefined();
        });

        it("should set and get session", async () => {
            await crawler.setSession("session_id=abc123");
            const session = await crawler.getSession();
            expect(session).toBe("session_id=abc123");
        });

        it("should clear session", async () => {
            await crawler.setSession("session_id=abc123");
            await crawler.clearSession();
            const session = await crawler.getSession();
            expect(session).toBeUndefined();
        });
    });

    describe("credential management", () => {
        it("should return undefined when no credentials exist", async () => {
            const creds = await crawler.getCredentials();
            expect(creds).toBeUndefined();
        });

        it("should save and retrieve credentials", async () => {
            await crawler.saveCredentials("myuser", "mypass");
            const creds = await crawler.getCredentials();
            expect(creds).toEqual({ username: "myuser", password: "mypass" });
        });

        it("should detect when credentials exist", async () => {
            expect(await crawler.hasCredentials()).toBe(false);
            await crawler.saveCredentials("u", "p");
            expect(await crawler.hasCredentials()).toBe(true);
        });

        it("should clear credentials", async () => {
            await crawler.saveCredentials("u", "p");
            await crawler.clearCredentials();
            expect(await crawler.getCredentials()).toBeUndefined();
            expect(await crawler.hasCredentials()).toBe(false);
        });

        it("tryAutoLogin should return false when no credentials stored", async () => {
            const result = await crawler.tryAutoLogin();
            expect(result).toBe(false);
        });

        it("getCredentials should return undefined for corrupted JSON", async () => {
            // Write malformed JSON directly to storage
            await storage.set("credentials", "{broken json!!}");
            const creds = await crawler.getCredentials();
            expect(creds).toBeUndefined();
        });
    });

    describe("concurrent tryAutoLogin deduplication", () => {
        it("should share a single in-flight login across concurrent callers", async () => {
            const crawl = new Crawler({ storage });

            // Pre-store valid credentials
            await crawl.saveCredentials("user", "pass");

            // Mock: login response
            const loginResponse = new Response("...", {
                status: 200,
                headers: { "Set-Cookie": "MoodleSession=shared" },
            });
            // Mock: session check response
            const homeResponse = new Response(
                '<html><body><div class="user-info-menu">OK</div></body></html>',
                { status: 200 }
            );

            mockFetch.mockResolvedValueOnce(loginResponse);
            mockFetch.mockResolvedValueOnce(homeResponse);

            // Fire 3 concurrent tryAutoLogin calls
            const [r1, r2, r3] = await Promise.all([
                crawl.tryAutoLogin(),
                crawl.tryAutoLogin(),
                crawl.tryAutoLogin(),
            ]);

            // All should succeed
            expect(r1).toBe(true);
            expect(r2).toBe(true);
            expect(r3).toBe(true);

            // fetchWithBase should only be called twice (login + session check),
            // not 6 times (3 × 2), proving deduplication
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
    });

    describe("HTML parsing", () => {
        it("should parse HTML string", () => {
            const html = '<div class="test">Hello, World!</div>';
            const doc = crawler.parseHtml(html);

            const el = doc.querySelector(".test");
            expect(el?.textContent).toBe("Hello, World!");
        });

        it("should query elements with querySelectorAll", () => {
            const html = `
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
          <li>Item 3</li>
        </ul>
      `;
            const doc = crawler.parseHtml(html);

            const items = doc.querySelectorAll("li");
            expect(items.length).toBe(3);
        });
    });

    describe("URL resolution", () => {
        it("should resolve relative URL with baseUrl", async () => {
            const crawlerWithBase = new Crawler({
                storage,
                baseUrl: "https://example.com",
            });

            // Mock a successful response so fetch() doesn't throw
            mockFetch.mockResolvedValueOnce(
                new Response("<html></html>", { status: 200 })
            );

            const response = await crawlerWithBase.fetch("/path");
            expect(response.status).toBe(200);
        });
    });

    describe("constructor options", () => {
        it("should use default values", () => {
            const defaultCrawler = new Crawler();
            expect(defaultCrawler).toBeDefined();
        });

        it("should use custom storage", async () => {
            const customStorage = new MemoryStorage();
            await customStorage.set("session", "existing_session");

            const customCrawler = new Crawler({ storage: customStorage });
            // The crawler uses "session" key for session storage
            expect(await customCrawler.getSession()).toBe("existing_session");
        });

        it("should use custom timeout", () => {
            const customCrawler = new Crawler({ timeout: 5000 });
            expect(customCrawler).toBeDefined();
        });
    });

    describe("getQuizDetail", () => {
        function buildQuizHtml(opts?: {
            name?: string;
            description?: string;
            infoParagraphs?: string[];
            attemptHtml?: string;
        }): string {
            const name = opts?.name ?? "퀴즈_6차";
            const description =
                opts?.description ?? "이것은 테스트 퀴즈입니다.";
            const infoParagraphs = opts?.infoParagraphs ?? [
                "Attempts allowed: 1",
                "This quiz opened at 2026-05-19 09:00",
                "This quiz will close at 2026-05-25 23:55",
                "Time limit: 1 day",
            ];
            const attemptHtml =
                opts?.attemptHtml ??
                `<div class="quizattempt">
                    <div class="quizstartbuttondiv">
                        <input type="submit" value="Start attempt" />
                    </div>
                </div>`;

            return `
                <html><body>
                    <div role="main">
                        <h2>${name}</h2>
                    </div>
                    <div id="intro">
                        <div class="no-overflow">${description}</div>
                    </div>
                    <div class="quizinfo">
                        ${infoParagraphs.map((p) => `<p>${p}</p>`).join("")}
                    </div>
                    ${attemptHtml}
                </body></html>
            `;
        }

        it("should parse quiz detail with 'not_started' status", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(buildQuizHtml(), { status: 200 })
            );

            const quiz = await crawler.getQuizDetail("677443");

            expect(quiz.id).toBe("677443");
            expect(quiz.name).toBe("퀴즈_6차");
            expect(quiz.description).toBe("이것은 테스트 퀴즈입니다.");
            expect(quiz.attemptsAllowed).toBe("1");
            expect(quiz.openedAt).toBe("2026-05-19 09:00");
            expect(quiz.closedAt).toBe("2026-05-25 23:55");
            expect(quiz.timeLimit).toBe("1 day");
            expect(quiz.attemptStatus).toBe("not_started");
        });

        it("should parse quiz detail with 'in_progress' status", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildQuizHtml({
                        attemptHtml: `
                            <div class="quizattempt">
                                <table class="generaltable quizattemptsummary">
                                    <tbody><tr><td>Attempt 1</td></tr></tbody>
                                </table>
                                <a href="attempt.php?attempt=123">Continue the last attempt</a>
                            </div>
                        `,
                    }),
                    { status: 200 }
                )
            );

            const quiz = await crawler.getQuizDetail("677443");
            expect(quiz.attemptStatus).toBe("in_progress");
        });

        it("should parse quiz detail with 'finished' status (summary table, no continue)", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildQuizHtml({
                        attemptHtml: `
                            <div class="quizattempt">
                                <table class="generaltable quizattemptsummary">
                                    <tbody>
                                        <tr><td>Attempt 1</td><td>90</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        `,
                    }),
                    { status: 200 }
                )
            );

            const quiz = await crawler.getQuizDetail("677443");
            expect(quiz.attemptStatus).toBe("finished");
        });

        it("should parse quiz detail with 'finished' status (re-attempt button + existing attempts)", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildQuizHtml({
                        attemptHtml: `
                            <div class="quizattempt">
                                <table>
                                    <tbody>
                                        <tr><td>Attempt 1</td><td>80</td></tr>
                                    </tbody>
                                </table>
                                <div class="quizstartbuttondiv">
                                    <input type="submit" value="Re-attempt quiz" />
                                </div>
                            </div>
                        `,
                    }),
                    { status: 200 }
                )
            );

            const quiz = await crawler.getQuizDetail("677443");
            expect(quiz.attemptStatus).toBe("finished");
        });

        it("should return 'unknown' status when no quizattempt block", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(buildQuizHtml({ attemptHtml: "" }), {
                    status: 200,
                })
            );

            const quiz = await crawler.getQuizDetail("677443");
            expect(quiz.attemptStatus).toBe("unknown");
        });

        it("should handle description with HTML entities correctly", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildQuizHtml({
                        description:
                            "O&#160;X 퀴즈입니다. &lt;주관식&gt; 문제는&#160;없습니다.",
                    }),
                    { status: 200 }
                )
            );

            const quiz = await crawler.getQuizDetail("677443");
            // textContent should return decoded text
            expect(quiz.description).toContain("O");
            expect(quiz.description).toContain("X");
            expect(quiz.description).not.toContain("&#160;");
            expect(quiz.description).not.toContain("&lt;");
        });

        it("should handle missing quizinfo fields gracefully", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildQuizHtml({
                        infoParagraphs: [],
                    }),
                    { status: 200 }
                )
            );

            const quiz = await crawler.getQuizDetail("677443");
            expect(quiz.attemptsAllowed).toBe("");
            expect(quiz.openedAt).toBe("");
            expect(quiz.closedAt).toBe("");
            expect(quiz.timeLimit).toBe("");
        });

        it("should handle closed quiz info", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildQuizHtml({
                        infoParagraphs: [
                            "Attempts allowed: 2",
                            "This quiz opened at 2026-05-01 09:00",
                            "This quiz closed at 2026-05-10 23:55",
                            "Time limit: 1 hour",
                        ],
                    }),
                    { status: 200 }
                )
            );

            const quiz = await crawler.getQuizDetail("677443");
            expect(quiz.closedAt).toBe("2026-05-10 23:55");
            expect(quiz.attemptsAllowed).toBe("2");
            expect(quiz.timeLimit).toBe("1 hour");
        });

        it("should use fallback h2 selector when [role='main'] h2 is missing", async () => {
            const html = `
                <html><body>
                    <h2>Fallback Quiz Name</h2>
                    <div id="intro"><div class="no-overflow">desc</div></div>
                    <div class="quizinfo"></div>
                </body></html>
            `;
            mockFetch.mockResolvedValueOnce(
                new Response(html, { status: 200 })
            );

            const quiz = await crawler.getQuizDetail("677443");
            expect(quiz.name).toBe("Fallback Quiz Name");
        });

        it("should escape user input in path", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(buildQuizHtml(), { status: 200 })
            );

            // Should not throw — cmid with special characters should be URL-encoded safely
            await expect(
                crawler.getQuizDetail("123<script>")
            ).resolves.toBeDefined();
        });
    });
});
