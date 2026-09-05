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

    describe("getAssignmentDetail", () => {
        function buildAssignmentHtml(opts?: {
            name?: string;
            description?: string;
            statusRows?: Array<{ label: string; value: string }>;
            fileRows?: Array<{ name: string; url: string }>;
        }): string {
            const name = opts?.name ?? "11주차 활동보고서";
            const description =
                opts?.description ?? "이것은 테스트 과제입니다.";
            const statusRows = opts?.statusRows ?? [
                {
                    label: "Submission status",
                    value: "No attempt",
                },
                {
                    label: "Grading status",
                    value: "Not graded",
                },
                { label: "Due date", value: "2026-05-20 00:00" },
                {
                    label: "Time remaining",
                    value: "Assignment is overdue by: 2 days 17 hours",
                },
                { label: "Last modified", value: "-" },
            ];
            const fileRows = opts?.fileRows ?? [];
            const fileRowHtml = fileRows.length
                ? `
                                        <tr>
                                            <td class="cell c0">File submissions</td>
                                            <td class="cell c1 lastcol">
                                                ${fileRows
                                                    .map(
                                                        (f) =>
                                                            `<a href="${f.url}">${f.name}</a>`
                                                    )
                                                    .join(" ")}
                                            </td>
                                        </tr>`
                : "";

            return `
                <html><body>
                    <div role="main">
                        <h2>${name}</h2>
                    </div>
                    <div id="intro">
                        <div class="no-overflow">${description}</div>
                    </div>
                    <div class="submissionstatustable">
                        <h3>Submission status</h3>
                        <div class="box boxaligncenter submissionsummarytable">
                            <table class="generaltable">
                                <tbody>
                                    ${statusRows
                                        .map(
                                            (r) => `
                                        <tr>
                                            <td class="cell c0">${r.label}</td>
                                            <td class="cell c1 lastcol">${r.value}</td>
                                        </tr>
                                    `
                                        )
                                        .join("")}
                                    ${fileRowHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </body></html>
            `;
        }

        it("should parse assignment detail correctly", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(buildAssignmentHtml(), { status: 200 })
            );

            const assignment = await crawler.getAssignmentDetail("674989");

            expect(assignment.id).toBe("674989");
            expect(assignment.name).toBe("11주차 활동보고서");
            expect(assignment.description).toBe("이것은 테스트 과제입니다.");
            expect(assignment.submissionStatus).toBe("No attempt");
            expect(assignment.gradingStatus).toBe("Not graded");
            expect(assignment.dueDate).toBe("2026-05-20 00:00");
            expect(assignment.timeRemaining).toBe(
                "Assignment is overdue by: 2 days 17 hours"
            );
            expect(assignment.lastModified).toBe("-");
            expect(assignment.files).toEqual([]);
        });

        it("should handle submitted assignment", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildAssignmentHtml({
                        statusRows: [
                            {
                                label: "Submission status",
                                value: "Submitted for grading",
                            },
                            { label: "Grading status", value: "Graded" },
                            {
                                label: "Due date",
                                value: "2026-03-30 23:50",
                            },
                            {
                                label: "Time remaining",
                                value: "1 day 3 hours",
                            },
                            {
                                label: "Last modified",
                                value: "2026-03-30 22:15",
                            },
                        ],
                    }),
                    { status: 200 }
                )
            );

            const assignment = await crawler.getAssignmentDetail("658841");

            expect(assignment.submissionStatus).toBe("Submitted for grading");
            expect(assignment.gradingStatus).toBe("Graded");
            expect(assignment.lastModified).toBe("2026-03-30 22:15");
        });

        it("should handle missing description", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(buildAssignmentHtml({ description: "" }), {
                    status: 200,
                })
            );

            const assignment = await crawler.getAssignmentDetail("674989");
            expect(assignment.description).toBe("");
        });

        it("should handle missing status table", async () => {
            const html = `
                <html><body>
                    <div role="main">
                        <h2>Empty Assignment</h2>
                    </div>
                    <div id="intro"></div>
                </body></html>
            `;
            mockFetch.mockResolvedValueOnce(
                new Response(html, { status: 200 })
            );

            const assignment = await crawler.getAssignmentDetail("674989");
            expect(assignment.submissionStatus).toBe("");
            expect(assignment.gradingStatus).toBe("");
            expect(assignment.dueDate).toBe("");
        });

        it("should use fallback h2 selector when [role='main'] h2 is missing", async () => {
            const html = `
                <html><body>
                    <h2>Fallback Assignment</h2>
                    <div id="intro">desc</div>
                    <div class="submissionstatustable">
                        <table class="generaltable"><tbody></tbody></table>
                    </div>
                </body></html>
            `;
            mockFetch.mockResolvedValueOnce(
                new Response(html, { status: 200 })
            );

            const assignment = await crawler.getAssignmentDetail("674989");
            expect(assignment.name).toBe("Fallback Assignment");
        });

        it("should handle description with HTML entities", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildAssignmentHtml({
                        description:
                            "O&#160;X 과제입니다. &lt;파일 제출&gt; 필수",
                    }),
                    { status: 200 }
                )
            );

            const assignment = await crawler.getAssignmentDetail("674989");
            expect(assignment.description).toContain("O");
            expect(assignment.description).not.toContain("&#160;");
            expect(assignment.description).not.toContain("&lt;");
        });

        it("should extract file submissions", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildAssignmentHtml({
                        fileRows: [
                            {
                                name: "202500041.zip",
                                url: "https://ecampus.example.com/pluginfile.php?file=/submission.zip",
                            },
                        ],
                    }),
                    { status: 200 }
                )
            );

            const assignment = await crawler.getAssignmentDetail("658841");
            expect(assignment.files).toHaveLength(1);
            expect(assignment.files[0]?.name).toBe("202500041.zip");
            expect(assignment.files[0]?.url).toContain("pluginfile.php");
        });

        it("should handle partial status rows (only some fields)", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildAssignmentHtml({
                        statusRows: [
                            {
                                label: "Submission status",
                                value: "Submitted for grading",
                            },
                            { label: "Due date", value: "2026-05-20 00:00" },
                        ],
                    }),
                    { status: 200 }
                )
            );

            const assignment = await crawler.getAssignmentDetail("674989");
            expect(assignment.submissionStatus).toBe("Submitted for grading");
            expect(assignment.dueDate).toBe("2026-05-20 00:00");
            // Fields not in the table should remain empty
            expect(assignment.gradingStatus).toBe("");
            expect(assignment.timeRemaining).toBe("");
        });
    });

    describe("getResources", () => {
        function buildCourseHtml(
            sections: Array<{
                weekTitle: string;
                activities: Array<{
                    id: string;
                    type: "assign" | "quiz" | "ubfile" | "vod";
                    name: string;
                }>;
            }>
        ): string {
            const sectionsHtml = sections
                .map(
                    (sec) => `
                <li class="section main" id="${sec.weekTitle.toLowerCase().replace(/\s+/g, "-")}">
                    <div class="sectionname">${sec.weekTitle}</div>
                    <ul class="section">
                    ${sec.activities
                        .map(
                            (a) => `
                        <li class="activity modtype_${a.type}" id="module-${a.id}">
                            <a href="https://ecampus.kangnam.ac.kr/mod/${a.type === "ubfile" ? "ubfile" : a.type}/view.php?id=${a.id}">
                                <span class="instancename">${a.name}</span>
                            </a>
                        </li>
                    `
                        )
                        .join("")}
                    </ul>
                </li>
            `
                )
                .join("");

            return `<html><body><ul class="weeks ubsweeks">${sectionsHtml}</ul></body></html>`;
        }

        it("should return only ubfile type resources", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildCourseHtml([
                        {
                            weekTitle: "1주차",
                            activities: [
                                {
                                    id: "100",
                                    type: "ubfile",
                                    name: "1주차 강의노트.pdf",
                                },
                                {
                                    id: "101",
                                    type: "assign",
                                    name: "1주차 과제",
                                },
                            ],
                        },
                        {
                            weekTitle: "2주차",
                            activities: [
                                {
                                    id: "200",
                                    type: "ubfile",
                                    name: "2주차 자료.zip",
                                },
                                {
                                    id: "201",
                                    type: "quiz",
                                    name: "2주차 퀴즈",
                                },
                            ],
                        },
                    ]),
                    { status: 200 }
                )
            );

            const resources = await crawler.getResources("49341");

            expect(resources).toHaveLength(2);
            expect(resources[0]?.name).toBe("1주차 강의노트.pdf");
            expect(resources[0]?.weekTitle).toBe("1주차");
            expect(resources[0]?.id).toBe("100");
            expect(resources[1]?.name).toBe("2주차 자료.zip");
            expect(resources[1]?.weekTitle).toBe("2주차");
        });

        it("should return empty array when no ubfile resources exist", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildCourseHtml([
                        {
                            weekTitle: "1주차",
                            activities: [
                                { id: "100", type: "assign", name: "과제 1" },
                                { id: "101", type: "quiz", name: "퀴즈 1" },
                            ],
                        },
                    ]),
                    { status: 200 }
                )
            );

            const resources = await crawler.getResources("49341");
            expect(resources).toHaveLength(0);
        });
    });

    describe("getResourceDetail", () => {
        function buildResourceHtml(opts?: {
            name?: string;
            description?: string;
            fileLinks?: Array<{ name: string; url: string }>;
        }): string {
            const name = opts?.name ?? "1주차_강의노트.pdf";
            const description = opts?.description ?? "1주차 강의 자료입니다.";
            const fileLinks = opts?.fileLinks ?? [
                {
                    name: "lecture_week1.pdf",
                    url: "https://ecampus.kangnam.ac.kr/pluginfile.php/123/mod_ubfile/content/1/lecture_week1.pdf",
                },
            ];

            return `
                <html><body>
                    <div role="main">
                        <h2>${name}</h2>
                    </div>
                    <div id="intro">
                        <div class="no-overflow">${description}</div>
                        ${fileLinks
                            .map((f) => `<a href="${f.url}">${f.name}</a>`)
                            .join("")}
                    </div>
                </body></html>
            `;
        }

        it("should parse resource detail with file links", async () => {
            const html = `
                <html><body>
                    <div role="main">
                        <h2>1주차_강의노트.pdf</h2>
                    </div>
                    <div id="intro">
                        <div class="no-overflow">1주차 강의 자료입니다.</div>
                        <a href="https://ecampus.kangnam.ac.kr/pluginfile.php/123/mod_ubfile/content/1/lecture_week1.pdf">lecture_week1.pdf</a>
                    </div>
                </body></html>
            `;
            mockFetch.mockResolvedValueOnce(
                new Response(html, { status: 200 })
            );

            const resource = await crawler.getResourceDetail("658841");

            expect(resource.id).toBe("658841");
            expect(resource.name).toBe("1주차_강의노트.pdf");
            expect(resource.description).toContain("1주차 강의 자료입니다.");
            expect(resource.files).toHaveLength(1);
            expect(resource.files[0]?.name).toBe("lecture_week1.pdf");
            expect(resource.files[0]?.url).toContain("pluginfile.php");
        });

        it("should parse resource detail with multiple file links", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildResourceHtml({
                        name: "복수 파일 자료",
                        description: "여러 파일이 있는 자료입니다.",
                        fileLinks: [
                            {
                                name: "lecture.pdf",
                                url: "https://ecampus.kangnam.ac.kr/pluginfile.php/1/mod_ubfile/content/1/lecture.pdf",
                            },
                            {
                                name: "slides.pptx",
                                url: "https://ecampus.kangnam.ac.kr/pluginfile.php/2/mod_ubfile/content/1/slides.pptx",
                            },
                        ],
                    }),
                    { status: 200 }
                )
            );

            const resource = await crawler.getResourceDetail("658842");

            expect(resource.files).toHaveLength(2);
            expect(resource.files[0]?.name).toBe("lecture.pdf");
            expect(resource.files[1]?.name).toBe("slides.pptx");
        });

        it("should handle resource detail with no file links", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(buildResourceHtml({ fileLinks: [] }), {
                    status: 200,
                })
            );

            const resource = await crawler.getResourceDetail("658843");

            expect(resource.name).toBe("1주차_강의노트.pdf");
            expect(resource.files).toHaveLength(0);
        });

        it("should handle HTML entities in description", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildResourceHtml({
                        description: "O&#160;X 퀴즈입니다. &lt;참고&gt;",
                    }),
                    { status: 200 }
                )
            );

            const resource = await crawler.getResourceDetail("658844");

            expect(resource.description).toContain("O");
            expect(resource.description).not.toContain("&#160;");
            expect(resource.description).not.toContain("&lt;");
        });

        it("should handle missing intro section", async () => {
            const html = `
                <html><body>
                    <div role="main">
                        <h2>자료명만 있는 경우</h2>
                    </div>
                </body></html>
            `;
            mockFetch.mockResolvedValueOnce(
                new Response(html, { status: 200 })
            );

            const resource = await crawler.getResourceDetail("658845");

            expect(resource.name).toBe("자료명만 있는 경우");
            expect(resource.description).toBe("");
            expect(resource.files).toHaveLength(0);
        });
    });

    describe("syllabus", () => {
        const sampleCourseHtml = `
            <html><body>
                <ul>
                    <li class="expand">
                        <ul>
                            <li><a href="#" class="submenu-syllabus" onclick="window.open('https://app.kangnam.ac.kr/knumis/sbr/syllabus2026.jsp?schl_year=2026&schl_smst=2&subj_numb=NE21705&lctr_clas=00&empl_numb=103609&rz=xyz','copyright','width=850'); return false;">Syllabus</a></li>
                        </ul>
                    </li>
                </ul>
            </body></html>
        `;

        describe("getSyllabusParams", () => {
            it("should parse syllabus parameters correctly from course page", async () => {
                mockFetch.mockResolvedValueOnce(
                    new Response(sampleCourseHtml, { status: 200 })
                );

                const params = await crawler.getSyllabusParams("53472");

                expect(params).toEqual({
                    year: "2026",
                    smst: "2",
                    subjNumb: "NE21705",
                    lctrClas: "00",
                    emplNumb: "103609",
                });
            });

            it("should throw error when syllabus link is missing", async () => {
                mockFetch.mockResolvedValueOnce(
                    new Response("<html><body>No syllabus</body></html>", {
                        status: 200,
                    })
                );

                await expect(
                    crawler.getSyllabusParams("50949")
                ).rejects.toThrow("강의계획서 링크를 찾을 수 없습니다");
            });

            it("should throw error when parameters are incomplete", async () => {
                const brokenHtml = `
                    <html><body>
                        <a class="submenu-syllabus" onclick="window.open('https://app.kangnam.ac.kr/knumis/sbr/syllabus2026.jsp?schl_year=2026')">Syllabus</a>
                    </body></html>
                `;
                mockFetch.mockResolvedValueOnce(
                    new Response(brokenHtml, { status: 200 })
                );

                await expect(
                    crawler.getSyllabusParams("53472")
                ).rejects.toThrow("강의계획서 파라미터가 불완전합니다");
            });
        });

        describe("downloadSyllabusPdf", () => {
            it("should request PDF generation and save to destination", async () => {
                mockFetch.mockResolvedValueOnce(
                    new Response(sampleCourseHtml, { status: 200 })
                );

                const originalGlobalFetch = globalThis.fetch;
                const globalFetchMock = vi.fn<typeof fetch>();
                // 1. ReportingServer service POST (PDF creation)
                globalFetchMock.mockResolvedValueOnce(
                    new Response("1|2026/09/05/test1234.pdf", { status: 200 })
                );
                // 2. ReportingServer download GET (PDF binary)
                const dummyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
                globalFetchMock.mockResolvedValueOnce(
                    new Response(dummyPdf, { status: 200 })
                );
                globalThis.fetch = globalFetchMock;

                try {
                    const dest =
                        "c:/Users/PC/Projects/VSCode/kampus/.tmp/test_download.pdf";
                    const saved = await crawler.downloadSyllabusPdf(
                        "53472",
                        dest
                    );
                    expect(saved).toContain("test_download.pdf");
                } finally {
                    globalThis.fetch = originalGlobalFetch;
                }
            });
        });
    });
});
