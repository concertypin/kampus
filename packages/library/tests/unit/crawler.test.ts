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
                <html><body id="page-mod-quiz-view" class="path-mod path-mod-quiz cmid-433393">
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

            const quiz = await crawler.getQuizDetail("433393");

            expect(quiz.id).toBe("433393");
            expect(quiz.name).toBe("퀴즈_6차");
            expect(quiz.description).toBe("이것은 테스트 퀴즈입니다.");
            expect(quiz.attemptsAllowed).toBe("1");
            expect(quiz.openedAt).toBe("2026-05-19 09:00");
            expect(quiz.closedAt).toBe("2026-05-25 23:55");
            expect(quiz.timeLimit).toBe("1 day");
            expect(quiz.attemptStatus).toBe("not_started");
        });

        it("should return 'unknown' status when no quizattempt block", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(buildQuizHtml({ attemptHtml: "" }), {
                    status: 200,
                })
            );

            const quiz = await crawler.getQuizDetail("433393");
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

            const quiz = await crawler.getQuizDetail("433393");
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

            const quiz = await crawler.getQuizDetail("433393");
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

            const quiz = await crawler.getQuizDetail("433393");
            expect(quiz.closedAt).toBe("2026-05-10 23:55");
            expect(quiz.attemptsAllowed).toBe("2");
            expect(quiz.timeLimit).toBe("1 hour");
        });

        it("should use fallback h2 selector when [role='main'] h2 is missing", async () => {
            const html = `
                <html><body id="page-mod-quiz-view" class="path-mod cmid-433393">
                    <h2>Fallback Quiz Name</h2>
                    <div id="intro"><div class="no-overflow">desc</div></div>
                    <div class="quizinfo"></div>
                </body></html>
            `;
            mockFetch.mockResolvedValueOnce(
                new Response(html, { status: 200 })
            );

            const quiz = await crawler.getQuizDetail("433393");
            expect(quiz.name).toBe("Fallback Quiz Name");
        });

        it("keeps a cmid with special characters inside the query of the view URL, and refuses the answer", async () => {
            mockFetch.mockReset();
            mockFetch.mockResolvedValueOnce(
                new Response(buildQuizHtml(), { status: 200 })
            );

            // No page can state that it belongs to a module with such an id
            await expect(crawler.getQuizDetail("123<script>")).rejects.toThrow(
                "the response is not the page of this quiz"
            );
            const requested = new URL(String(mockFetch.mock.calls[0]?.[0]));
            expect(requested.origin).toBe("https://ecampus.kangnam.ac.kr");
            expect(requested.pathname).toBe("/mod/quiz/view.php");
            expect(requested.search).toBe("?id=123%3Cscript%3E");
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
                <html><body id="page-mod-assign-view" class="path-mod path-mod-assign cmid-426033">
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

            const assignment = await crawler.getAssignmentDetail("426033");

            expect(assignment.id).toBe("426033");
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

            const assignment = await crawler.getAssignmentDetail("426033");

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

            const assignment = await crawler.getAssignmentDetail("426033");
            expect(assignment.description).toBe("");
        });

        it("should refuse a page that is not the assignment's view page without echoing it", async () => {
            const hostile = "\u001b[2JHOSTILE-BODY\u202e";
            mockFetch.mockResolvedValueOnce(
                new Response(
                    `<html><body id="page-course-view-ubsweeks"><p>${hostile}</p></body></html>`,
                    { status: 200 }
                )
            );

            const error = await crawler
                .getAssignmentDetail("426033")
                .catch((err: unknown) => err);

            expect(error).toBeInstanceOf(Error);
            expect(String(error)).toBe(
                "Error: Failed to load assignment 426033: not the assignment page (HTTP 200)"
            );
        });

        it("should report the site's error message for an error page", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    `<html><body id="page-site-index"><p class="errormessage">Invalid course module ID</p><p>secret raw text</p></body></html>`,
                    { status: 404 }
                )
            );

            await expect(crawler.getAssignmentDetail("426033")).rejects.toThrow(
                /^Failed to load assignment 426033: Invalid course module ID$/
            );
        });

        it("should refuse the view page of another module", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    '<html><body id="page-mod-assign-view" class="cmid-999"><div role="main"><h2>x</h2></div></body></html>',
                    { status: 200 }
                )
            );

            await expect(crawler.getAssignmentDetail("426033")).rejects.toThrow(
                "Failed to load assignment 426033"
            );
        });

        it("should handle missing status table", async () => {
            const html = `
                <html><body id="page-mod-assign-view" class="path-mod cmid-426033">
                    <div role="main">
                        <h2>Empty Assignment</h2>
                    </div>
                    <div id="intro"></div>
                </body></html>
            `;
            mockFetch.mockResolvedValueOnce(
                new Response(html, { status: 200 })
            );

            const assignment = await crawler.getAssignmentDetail("426033");
            expect(assignment.submissionStatus).toBe("");
            expect(assignment.gradingStatus).toBe("");
            expect(assignment.dueDate).toBe("");
        });

        it("should use fallback h2 selector when [role='main'] h2 is missing", async () => {
            const html = `
                <html><body id="page-mod-assign-view" class="path-mod cmid-426033">
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

            const assignment = await crawler.getAssignmentDetail("426033");
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

            const assignment = await crawler.getAssignmentDetail("426033");
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
                                name: "300123456.zip",
                                url: "https://ecampus.kangnam.ac.kr/pluginfile.php?file=/submission.zip",
                            },
                        ],
                    }),
                    { status: 200 }
                )
            );

            const assignment = await crawler.getAssignmentDetail("426033");
            expect(assignment.files).toHaveLength(1);
            expect(assignment.files[0]?.name).toBe("300123456.zip");
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

            const assignment = await crawler.getAssignmentDetail("426033");
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

            const resources = await crawler.getResources("342309");

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

            const resources = await crawler.getResources("342309");
            expect(resources).toHaveLength(0);
        });

        it("should list a resource once when the current week is repeated", async () => {
            const week = {
                weekTitle: "7주차",
                activities: [
                    { id: "700", type: "ubfile" as const, name: "7주차.pdf" },
                ],
            };
            mockFetch.mockResolvedValueOnce(
                new Response(buildCourseHtml([week, week]), { status: 200 })
            );

            const resources = await crawler.getResources("342309");

            expect(resources.map((r) => r.id)).toEqual(["700"]);
        });
    });

    describe("getResourceDetail", () => {
        /** `<body>` as Moodle renders it on the view page of module `cmid`. */
        function viewBody(cmid: string): string {
            return `<body id="page-mod-ubfile-view" class="path-mod path-mod-ubfile cmid-${cmid}">`;
        }

        function buildResourceHtml(opts?: {
            cmid?: string;
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
                <html>${viewBody(opts?.cmid ?? "421889")}
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
                <html>${viewBody("421889")}
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

            const resource = await crawler.getResourceDetail("421889");

            expect(resource.id).toBe("421889");
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
                        cmid: "421890",
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

            const resource = await crawler.getResourceDetail("421890");

            expect(resource.files).toHaveLength(2);
            expect(resource.files[0]?.name).toBe("lecture.pdf");
            expect(resource.files[1]?.name).toBe("slides.pptx");
        });

        it("should handle resource detail with no file links", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildResourceHtml({ cmid: "421891", fileLinks: [] }),
                    {
                        status: 200,
                    }
                )
            );

            const resource = await crawler.getResourceDetail("421891");

            expect(resource.name).toBe("1주차_강의노트.pdf");
            expect(resource.files).toHaveLength(0);
        });

        // Shape of the live /mod/ubfile/view.php answer for a single-file
        // resource: 303 + Location, with Moodle's redirect page as the body.
        const PLUGINFILE_URL =
            "https://ecampus.kangnam.ac.kr/pluginfile.php?forcedownload=1&file=%2F100001%2Fmod_ubfile%2Fcontent%2F0%2F%281%EC%A3%BC%EC%B0%A8%29%20%EA%B0%95%EC%9D%98%20%EC%9E%90%EB%A3%8C.pdf";
        function buildRedirectHtml(url: string): string {
            return `<!DOCTYPE html>
<html  lang="en" xml:lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />

<title>Redirect</title>
</head><body><div style="margin-top: 3em; margin-left:auto; margin-right:auto; text-align:center;">This page should automatically redirect. If nothing is happening please use the continue link below.<br /><a href="${url.replaceAll("&", "&amp;")}">Continue</a></div></body></html>`;
        }

        it("should resolve the pluginfile URL from a 303 redirect without following it", async () => {
            mockFetch.mockClear();
            mockFetch.mockResolvedValueOnce(
                new Response(buildRedirectHtml(PLUGINFILE_URL), {
                    status: 303,
                    headers: {
                        "Content-Type": "text/html; charset=utf-8",
                        Location: PLUGINFILE_URL,
                    },
                })
            );

            const resource = await crawler.getResourceDetail("479444");

            // The file itself must not be requested just to list it
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(resource.files).toEqual([
                { name: "(1주차) 강의 자료.pdf", url: PLUGINFILE_URL },
            ]);
            expect(resource.name).toBe("(1주차) 강의 자료.pdf");
        });

        it("should decode &amp; in the redirect page link when Location is missing", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(buildRedirectHtml(PLUGINFILE_URL), {
                    status: 303,
                    headers: { "Content-Type": "text/html; charset=utf-8" },
                })
            );

            const resource = await crawler.getResourceDetail("479445");

            expect(resource.files).toHaveLength(1);
            expect(resource.files[0]?.url).toBe(PLUGINFILE_URL);
            expect(resource.files[0]?.url).not.toContain("&amp;");
            // Link text is "Continue", so the name comes from the URL
            expect(resource.files[0]?.name).toBe("(1주차) 강의 자료.pdf");
        });

        it("should extract the link from a redirect page served with 200", async () => {
            const html = `<html><head><meta http-equiv="refresh" content="0; url=${PLUGINFILE_URL.replaceAll("&", "&amp;")}"></head><body></body></html>`;
            mockFetch.mockResolvedValueOnce(
                new Response(html, {
                    status: 200,
                    headers: { "Content-Type": "text/html; charset=utf-8" },
                })
            );

            const resource = await crawler.getResourceDetail("479446");

            expect(resource.files).toEqual([
                { name: "(1주차) 강의 자료.pdf", url: PLUGINFILE_URL },
            ]);
        });

        it("should list every file of a multi-file page with decoded, absolute URLs", async () => {
            const html = `
                <html>${viewBody("479447")}
                    <div role="main">
                        <h2>3주차 자료 모음</h2>
                        <div id="intro"><p>설명</p></div>
                        <ul>
                            <li><a href="https://ecampus.kangnam.ac.kr/pluginfile.php?forcedownload=1&amp;file=%2F100002%2Fmod_ubfile%2Fcontent%2F0%2Fa.pdf">강의노트.pdf</a></li>
                            <li><a href="/pluginfile.php/100002/mod_ubfile/content/0/%EC%8B%A4%EC%8A%B5.zip?forcedownload=1"> </a></li>
                            <li><a href="https://ecampus.kangnam.ac.kr/pluginfile.php?forcedownload=1&amp;file=%2F100002%2Fmod_ubfile%2Fcontent%2F0%2Fa.pdf">강의노트.pdf</a></li>
                        </ul>
                    </div>
                </body></html>
            `;
            mockFetch.mockResolvedValueOnce(
                new Response(html, {
                    status: 200,
                    headers: { "Content-Type": "text/html; charset=utf-8" },
                })
            );

            const resource = await crawler.getResourceDetail("479447");

            expect(resource.name).toBe("3주차 자료 모음");
            // The name is the stored file name from the URL, not the link
            // text: this used to expect the label "강의노트.pdf", but labels
            // repeat ("다운로드") and then the files overwrite each other.
            expect(resource.files).toEqual([
                {
                    name: "a.pdf",
                    url: "https://ecampus.kangnam.ac.kr/pluginfile.php?forcedownload=1&file=%2F100002%2Fmod_ubfile%2Fcontent%2F0%2Fa.pdf",
                },
                {
                    name: "실습.zip",
                    url: "https://ecampus.kangnam.ac.kr/pluginfile.php/100002/mod_ubfile/content/0/%EC%8B%A4%EC%8A%B5.zip?forcedownload=1",
                },
            ]);
        });

        it("should treat a direct file response as the downloadable file", async () => {
            // fetch exposes the raw UTF-8 header bytes as Latin-1
            const rawName = String.fromCharCode(
                ...new TextEncoder().encode("강의 자료.pdf")
            );
            mockFetch.mockResolvedValueOnce(
                new Response("%PDF-1.7 binary", {
                    status: 200,
                    headers: {
                        "Content-Type": "application/pdf",
                        "Content-Disposition": `attachment; filename="${rawName}"`,
                    },
                })
            );

            const resource = await crawler.getResourceDetail("479448");

            expect(resource.files).toEqual([
                {
                    name: "강의 자료.pdf",
                    url: "https://ecampus.kangnam.ac.kr/mod/ubfile/view.php?id=479448",
                },
            ]);
            expect(resource.name).toBe("강의 자료.pdf");
        });

        // This used to assert that a 303 to any other page is followed and
        // that page's pluginfile links become the resource's files. That
        // encoded the implementation's guess: nothing ties such a page to
        // this resource, so its links are other modules' files.
        it("should refuse a 303 that points to a page that is not a file", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response("", {
                    status: 303,
                    headers: {
                        Location:
                            "https://ecampus.kangnam.ac.kr/mod/ubfile/other.php?id=479449",
                    },
                })
            );

            await expect(crawler.getResourceDetail("479449")).rejects.toThrow(
                "/mod/ubfile/other.php"
            );
            // The other page is not even requested
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("should handle HTML entities in description", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    buildResourceHtml({
                        cmid: "421892",
                        description: "O&#160;X 퀴즈입니다. &lt;참고&gt;",
                    }),
                    { status: 200 }
                )
            );

            const resource = await crawler.getResourceDetail("421892");

            expect(resource.description).toContain("O");
            expect(resource.description).not.toContain("&#160;");
            expect(resource.description).not.toContain("&lt;");
        });

        it("should handle missing intro section", async () => {
            const html = `
                <html>${viewBody("421893")}
                    <div role="main">
                        <h2>자료명만 있는 경우</h2>
                    </div>
                </body></html>
            `;
            mockFetch.mockResolvedValueOnce(
                new Response(html, { status: 200 })
            );

            const resource = await crawler.getResourceDetail("421893");

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
                            <li><a href="#" class="submenu-syllabus" onclick="window.open('https://app.kangnam.ac.kr/knumis/sbr/syllabus2026.jsp?schl_year=2026&schl_smst=2&subj_numb=AB12345&lctr_clas=00&empl_numb=383965&rz=xyz','copyright','width=850'); return false;">Syllabus</a></li>
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

                const params = await crawler.getSyllabusParams("374621");

                expect(params).toEqual({
                    year: "2026",
                    smst: "2",
                    subjNumb: "AB12345",
                    lctrClas: "00",
                    emplNumb: "383965",
                });
            });

            it("should throw error when syllabus link is missing", async () => {
                mockFetch.mockResolvedValueOnce(
                    new Response("<html><body>No syllabus</body></html>", {
                        status: 200,
                    })
                );

                await expect(
                    crawler.getSyllabusParams("356209")
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
                    crawler.getSyllabusParams("374621")
                ).rejects.toThrow("강의계획서 파라미터가 불완전합니다");
            });

            it("names the missing parameters without echoing the server values", async () => {
                const brokenHtml = `
                    <html><body>
                        <a class="submenu-syllabus" onclick="window.open('https://app.kangnam.ac.kr/knumis/sbr/syllabus2026.jsp?schl_year=EVIL%1B%5B2J')">Syllabus</a>
                    </body></html>
                `;
                mockFetch.mockResolvedValueOnce(
                    new Response(brokenHtml, { status: 200 })
                );

                const error = await crawler
                    .getSyllabusParams("374621")
                    .catch((e: unknown) => e);
                expect(error).toBeInstanceOf(Error);
                const message = error instanceof Error ? error.message : "";
                expect(message).toContain("schl_smst");
                expect(message).not.toContain("EVIL");
                expect(message).not.toContain("\u001b");
            });
        });

        describe("getSyllabusParams hostile onclick", () => {
            it("keeps the onclick text out of the error", async () => {
                const hostile = "\u001b[31mEVIL\u202e";
                mockFetch.mockResolvedValueOnce(
                    new Response(
                        `<html><body><a class="submenu-syllabus" onclick="${hostile}">S</a></body></html>`,
                        { status: 200 }
                    )
                );

                const error = await crawler
                    .getSyllabusParams("374621")
                    .catch((err: unknown) => err);

                expect(error).toBeInstanceOf(Error);
                expect(String(error)).toContain("강의계획서 링크 형식");
                expect(String(error)).not.toContain("EVIL");
                expect(String(error)).not.toContain("\u001b");
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
                        "374621",
                        dest
                    );
                    expect(saved).toContain("test_download.pdf");
                } finally {
                    globalThis.fetch = originalGlobalFetch;
                }
            });

            it("keeps an unexpected service response out of the error", async () => {
                mockFetch.mockResolvedValueOnce(
                    new Response(sampleCourseHtml, { status: 200 })
                );
                const globalFetchMock = vi.fn<typeof fetch>();
                globalFetchMock.mockResolvedValueOnce(
                    new Response("\u001b[31mEVIL-BODY\u202e", { status: 200 })
                );
                vi.stubGlobal("fetch", globalFetchMock);

                try {
                    const error = await crawler
                        .downloadSyllabusPdf("374621", ".tmp/never.pdf")
                        .catch((err: unknown) => err);

                    expect(error).toBeInstanceOf(Error);
                    expect(String(error)).toContain("유효한 PDF 파일명");
                    expect(String(error)).not.toContain("EVIL-BODY");
                    expect(String(error)).not.toContain("\u001b");
                } finally {
                    vi.unstubAllGlobals();
                }
            });

            it("percent-encodes the rdid in the download URL", async () => {
                mockFetch.mockResolvedValueOnce(
                    new Response(sampleCourseHtml, { status: 200 })
                );
                const globalFetchMock = vi.fn<typeof fetch>();
                globalFetchMock.mockResolvedValueOnce(
                    new Response("1|2026/09/05/a&delete=false.pdf", {
                        status: 200,
                    })
                );
                globalFetchMock.mockResolvedValueOnce(
                    new Response("no", { status: 500 })
                );
                vi.stubGlobal("fetch", globalFetchMock);

                try {
                    await crawler
                        .downloadSyllabusPdf("374621", ".tmp/never.pdf")
                        .catch(() => undefined);

                    const downloadUrl = globalFetchMock.mock.calls[1]?.[0];
                    expect(downloadUrl).toEqual(
                        expect.stringContaining("&rdid=a%26delete%3Dfalse&")
                    );
                } finally {
                    vi.unstubAllGlobals();
                }
            });
        });
    });

    describe("vods", () => {
        function buildCourseWithVodsHtml(): string {
            return `
                <html><body>
                    <ul class="weeks ubsweeks">
                        <li class="section main" id="section-1">
                            <div class="sectionname">1주차</div>
                            <ul class="section">
                                <li class="activity modtype_vod" id="module-1001">
                                    <div class="activityinstance">
                                        <a href="https://ecampus.kangnam.ac.kr/mod/vod/view.php?id=1001">
                                            <span class="instancename">1주차 1차시 영상<span class="accesshide"> VOD</span></span>
                                        </a>
                                        <span class="displayoptions">
                                            <span class="text-ubstrap">2026-09-01 00:00:00 ~ 2026-09-08 23:59:59 <span class="text-late">(Late : 2026-09-15 23:59:59)</span></span>
                                            <span class="text-info">, 25:30</span>
                                        </span>
                                    </div>
                                </li>
                            </ul>
                        </li>
                    </ul>
                </body></html>
            `;
        }

        function buildAttendanceHtml(): string {
            return `
                <html><body>
                    <table class="table table-bordered user_progress_table">
                        <tbody>
                            <tr>
                                <td>1</td>
                                <td>1주차 1차시 영상</td>
                                <td>25:00</td>
                                <td>10:00 View: 1 time(s)</td>
                                <td>O</td>
                                <td>O</td>
                            </tr>
                        </tbody>
                    </table>
                </body></html>
            `;
        }

        it("should parse VOD list and merge attendance status respecting raw OX", async () => {
            // 1. Attendance fetch
            mockFetch.mockResolvedValueOnce(
                new Response(buildAttendanceHtml(), { status: 200 })
            );
            // 2. Course view fetch
            mockFetch.mockResolvedValueOnce(
                new Response(buildCourseWithVodsHtml(), { status: 200 })
            );

            const vods = await crawler.getVods("340524");
            expect(vods).toHaveLength(1);
            expect(vods[0]?.id).toBe("1001");
            expect(vods[0]?.name).toBe("1주차 1차시 영상");
            expect(vods[0]?.week).toBe(1);
            expect(vods[0]?.duration).toBe("25:30");
            expect(vods[0]?.period).toBe(
                "2026-09-01 00:00:00 ~ 2026-09-08 23:59:59"
            );
            expect(vods[0]?.latePeriod).toBe("2026-09-15 23:59:59");
            // Crucial: watchedTime (10:00) < requiredTime (25:00), but raw status is "O", must respect raw "O"!
            expect(vods[0]?.status).toBe("O");
            expect(vods[0]?.watchedTime).toContain("10:00");
            expect(vods[0]?.requiredTime).toBe("25:00");
        });

        it("should parse VOD detail with m3u8 streaming url", async () => {
            const viewHtml = `
                <html><body id="page-mod-vod-view" class="path-mod cmid-1001">
                    <h2>테스트 강의</h2>
                    <div id="intro"><div class="no-overflow">강의 설명입니다.</div></div>
                    <div class="well">학습 인정기간 : 2026-09-01 00:00:00 ~ 2026-09-08 23:59:59</div>
                </body></html>
            `;
            const viewerHtml = `
                <html><head>
                    <script>
                        jwplayer('vod_player').setup({
                            playlist:[{
                                sources: [{file: 'https://vod3.kangnam.ac.kr/streams/playlist.m3u8'}]
                            }]
                        });
                    </script>
                </head><body></body></html>
            `;

            mockFetch.mockResolvedValueOnce(
                new Response(viewHtml, { status: 200 })
            );
            mockFetch.mockResolvedValueOnce(
                new Response(viewerHtml, { status: 200 })
            );

            const detail = await crawler.getVodDetail("1001");
            expect(detail.id).toBe("1001");
            expect(detail.name).toBe("테스트 강의");
            expect(detail.description).toBe("강의 설명입니다.");
            expect(detail.period).toBe(
                "2026-09-01 00:00:00 ~ 2026-09-08 23:59:59"
            );
            expect(detail.m3u8Url).toBe(
                "https://vod3.kangnam.ac.kr/streams/playlist.m3u8"
            );
        });

        it("should refuse a VOD page that is not the view page without echoing it", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    '<html><body id="page-site-index"><p class="errormessage">Invalid course module ID</p><p>raw page text</p></body></html>',
                    { status: 404 }
                )
            );

            await expect(crawler.getVodDetail("1002")).rejects.toThrow(
                /^Failed to load VOD 1002: Invalid course module ID$/
            );

            mockFetch.mockResolvedValueOnce(
                new Response("<html><body><p>raw page text</p></body></html>", {
                    status: 200,
                })
            );
            await expect(crawler.getVodDetail("1002")).rejects.toThrow(
                /^Failed to load VOD 1002: not the VOD page \(HTTP 200\)$/
            );
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it("should throw error if VOD conversion is not completed", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    '<html><body id="page-mod-vod-view" class="path-mod cmid-1002"><h2>미변환 강의</h2></body></html>',
                    { status: 200 }
                )
            );
            mockFetch.mockResolvedValueOnce(
                new Response(
                    "<html><head><script>alert('There are no converted VOD\\'s.');</script></head></html>",
                    { status: 200 }
                )
            );

            await expect(crawler.getVodDetail("1002")).rejects.toThrow(
                "변환된 VOD 영상이 존재하지 않습니다"
            );
        });
    });
});
