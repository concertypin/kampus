import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import { Crawler } from "@/crawler";
import { MemoryStorage } from "@/storage/memory";
import { fetchWithBase } from "@/client";

vi.mock("@/client", () => ({
    fetchWithBase: vi.fn<typeof fetchWithBase>(),
    BASE_URL: "https://ecampus.kangnam.ac.kr",
}));

const mockFetch = vi.mocked(fetchWithBase);

/** The path and query of a request the crawler handed to `fetchWithBase`. */
function requestPath(input: string | URL): string {
    const url = new URL(input, "https://ecampus.kangnam.ac.kr");
    return url.pathname + url.search;
}

function fixture(name: string): string {
    return readFileSync(
        join(import.meta.dirname, "..", "fixtures", "quiz", name),
        "utf8"
    );
}

/**
 * `<body>` as the site renders it on the view page of quiz `cmid`. The
 * captures below hold the main region only, so the attributes are put back
 * here. Confirmed by a read-only request to the live site (2026-10-14,
 * quiz 709855): `<body id="page-mod-quiz-view" class="... cmid-709855 ...">`.
 */
function asQuizPage(page: string, cmid: string): string {
    return page.replace(
        /<body[^>]*>/,
        `<body id="page-mod-quiz-view" class="format-ubsweeks path-mod path-mod-quiz cmid-${cmid} pagelayout-incourse">`
    );
}

/** Live captures (main region only, session data stripped). */
const VIEW_NOT_STARTED = asQuizPage(fixture("view_not_started.html"), "709855");
const VIEW_CLOSED_NO_ATTEMPT = asQuizPage(
    fixture("view_closed_no_attempt.html"),
    "705568"
);
const QUIZ_INDEX = fixture("index.html");
const COURSE_VIEW = fixture("course_view.html");

const ATTEMPT_BOX_START = '<div class="box quizattempt">';

/**
 * Attempt history as rendered by Moodle's `mod_quiz` renderer
 * (`view_table()`): a heading plus `table.quizattemptsummary`, emitted as a
 * sibling *before* the `.quizattempt` button box. No such page could be
 * captured live (no accessible attempted quiz), so these variants splice the
 * renderer's markup into the live "not started" capture.
 */
function summaryTable(rows: string, withAttemptColumn = false): string {
    return `<h3>Summary of your previous attempts</h3><table class="generaltable quizattemptsummary">
<thead>
<tr>
${withAttemptColumn ? '<th class="header c0" style="text-align:center;" scope="col">Attempt</th>' : ""}
<th class="header" style="text-align:left;" scope="col">State</th>
<th class="header" style="text-align:center;" scope="col">Grade / 10.00</th>
<th class="header lastcol" style="text-align:center;" scope="col">Review</th>
</tr>
</thead>
<tbody>${rows}</tbody>
</table>`;
}

const FINISHED_ROW = `<tr class="lastrow">
<td class="cell c0" style="text-align:left;">Finished<span class="statedetails">Submitted Thursday, 17 September 2026, 3:02 PM</span></td>
<td class="cell c1" style="text-align:center;">10.00</td>
<td class="cell c2 lastcol" style="text-align:center;"><a title="Review your responses to this attempt" href="https://ecampus.kangnam.ac.kr/mod/quiz/review.php?attempt=1">Review</a></td>
</tr>`;

const BACK_TO_COURSE_BOX = `<div class="box quizattempt"><p>No more attempts are allowed</p><div class="continuebutton"><form method="get" action="https://ecampus.kangnam.ac.kr/course/view.php"><div><input type="submit" value="Back to the course" /><input type="hidden" name="id" value="53380" /></div></form></div></div></div>
</div></body></html>`;

/** Submitted quiz, one attempt allowed: history table + "Back to the course". */
function viewFinished(): string {
    const head = VIEW_NOT_STARTED.slice(
        0,
        VIEW_NOT_STARTED.indexOf(ATTEMPT_BOX_START)
    );
    return head + summaryTable(FINISHED_ROW) + BACK_TO_COURSE_BOX;
}

/** Keeps the live button box, inserts a history table and relabels the button. */
function viewWithHistory(table: string, buttonLabel: string): string {
    return VIEW_NOT_STARTED.replace(
        ATTEMPT_BOX_START,
        table + ATTEMPT_BOX_START
    ).replace('value="Attempt quiz now"', `value="${buttonLabel}"`);
}

function html(body: string, status = 200): Response {
    return new Response(body, { status });
}

describe("Crawler quizzes", () => {
    let crawler: Crawler;

    beforeEach(() => {
        mockFetch.mockReset();
        crawler = new Crawler({ storage: new MemoryStorage() });
    });

    describe("getQuizDetail attempt status", () => {
        it("reports 'not_started' for an open quiz without attempts", async () => {
            mockFetch.mockResolvedValueOnce(html(VIEW_NOT_STARTED));

            const quiz = await crawler.getQuizDetail("709855");

            expect(quiz).toMatchObject({
                id: "709855",
                name: "퀴즈_4차",
                attemptsAllowed: "1",
                openedAt: "2026-10-13 09:00",
                closedAt: "2026-10-19 23:55",
                timeLimit: "1 day",
                attemptStatus: "not_started",
            });
        });

        it("reports 'not_started' for a closed quiz that was never attempted", async () => {
            mockFetch.mockResolvedValueOnce(html(VIEW_CLOSED_NO_ATTEMPT));

            const quiz = await crawler.getQuizDetail("705568");

            expect(quiz.attemptStatus).toBe("not_started");
            // "This quiz closed on <date>" must not leak the "on" prefix.
            expect(quiz.closedAt).toBe("2026-09-30 23:40");
        });

        it("reports 'finished' for a submitted quiz whose history table sits outside the button box", async () => {
            mockFetch.mockResolvedValueOnce(html(viewFinished()));

            const quiz = await crawler.getQuizDetail("709855");

            expect(quiz.attemptStatus).toBe("finished");
            expect(quiz.name).toBe("퀴즈_4차");
        });

        it("reports 'finished' when a submitted quiz still offers a re-attempt", async () => {
            mockFetch.mockResolvedValueOnce(
                html(
                    viewWithHistory(
                        summaryTable(FINISHED_ROW),
                        "Re-attempt quiz"
                    )
                )
            );

            const quiz = await crawler.getQuizDetail("709855");

            expect(quiz.attemptStatus).toBe("finished");
        });

        it("reports 'in_progress' when the latest attempt is still open", async () => {
            const rows = `<tr>
<td class="cell c0" style="text-align:center;">1</td>
<td class="cell c1" style="text-align:left;">Finished<span class="statedetails">Submitted Thursday, 17 September 2026, 3:02 PM</span></td>
<td class="cell c2" style="text-align:center;">10.00</td>
<td class="cell c3 lastcol" style="text-align:center;"><a href="https://ecampus.kangnam.ac.kr/mod/quiz/review.php?attempt=1">Review</a></td>
</tr>
<tr class="lastrow">
<td class="cell c0" style="text-align:center;">2</td>
<td class="cell c1" style="text-align:left;">In progress</td>
<td class="cell c2" style="text-align:center;"></td>
<td class="cell c3 lastcol" style="text-align:center;"></td>
</tr>`;
            mockFetch.mockResolvedValueOnce(
                html(
                    viewWithHistory(
                        summaryTable(rows, true),
                        "Continue the last attempt"
                    )
                )
            );

            const quiz = await crawler.getQuizDetail("709855");

            expect(quiz.attemptStatus).toBe("in_progress");
        });

        it("reports 'abandoned' when the latest attempt was never submitted", async () => {
            const row = `<tr class="lastrow">
<td class="cell c0" style="text-align:left;">Never submitted</td>
<td class="cell c1" style="text-align:center;"></td>
<td class="cell c2 lastcol" style="text-align:center;"></td>
</tr>`;
            mockFetch.mockResolvedValueOnce(
                html(
                    VIEW_CLOSED_NO_ATTEMPT.replace(
                        ATTEMPT_BOX_START,
                        summaryTable(row) + ATTEMPT_BOX_START
                    )
                )
            );

            const quiz = await crawler.getQuizDetail("705568");

            expect(quiz.attemptStatus).toBe("abandoned");
        });

        it("reports 'unavailable' when a quiz past its availability window redirects to the course page", async () => {
            mockFetch.mockResolvedValueOnce(html(COURSE_VIEW));

            const quiz = await crawler.getQuizDetail("699361");

            expect(quiz).toMatchObject({
                id: "699361",
                name: "퀴즈_2차",
                closedAt: "21 September 2026, 23:55 PM",
                attemptStatus: "unavailable",
            });
        });

        it("throws on Moodle's 'Invalid course module ID' error page", async () => {
            mockFetch.mockResolvedValueOnce(
                html(
                    `<html><body><div role="main"><span id="maincontent"></span><div class="alert alert-danger" data-rel="fatalerror"><p class="errormessage">Invalid course module ID</p></div></div></body></html>`,
                    404
                )
            );

            await expect(crawler.getQuizDetail("699395")).rejects.toThrow(
                "Invalid course module ID"
            );
        });
    });

    describe("getQuizzes", () => {
        /** Routes requests by path, like the live site would. */
        function mockSite(views: Record<string, string>): void {
            mockFetch.mockImplementation((input: string | URL) => {
                const url = requestPath(input);
                if (url.startsWith("/mod/quiz/index.php")) {
                    return Promise.resolve(html(QUIZ_INDEX));
                }
                if (url.startsWith("/course/view.php")) {
                    return Promise.resolve(html(COURSE_VIEW));
                }
                const cmid = url.match(/\/mod\/quiz\/view\.php\?id=(\d+)/)?.[1];
                const view = cmid ? views[cmid] : undefined;
                if (cmid && view) {
                    return Promise.resolve(html(asQuizPage(view, cmid)));
                }
                return Promise.reject(new Error(`Unexpected request: ${url}`));
            });
        }

        it("takes each closed quiz's cmid from its own module, not the preceding activity", async () => {
            mockSite({ "709855": VIEW_NOT_STARTED });

            const quizzes = await crawler.getQuizzes("53380");

            // The VODs right before each quiz are module-691640/699395/704386;
            // those must never be reported as quiz ids.
            expect(
                quizzes.map((q) => [q.id, q.name, q.week.split(" ")[0]])
            ).toEqual([
                ["691631", "퀴즈_1차", "1회차"],
                ["699361", "퀴즈_2차", "2회차"],
                ["704394", "퀴즈_3차", "3회차"],
                ["709855", "퀴즈_4차", "4회차"],
            ]);
            expect(quizzes[1]?.closesAt).toBe("21 September 2026, 23:55 PM");
        });

        it("reports the attempt status of every quiz", async () => {
            mockSite({ "709855": viewFinished() });

            const quizzes = await crawler.getQuizzes("53380");

            expect(quizzes.map((q) => [q.id, q.attemptStatus])).toEqual([
                ["691631", "unavailable"],
                ["699361", "unavailable"],
                ["704394", "unavailable"],
                ["709855", "finished"],
            ]);
        });

        it("only requests the view page of quizzes that are still reachable", async () => {
            mockSite({ "709855": VIEW_NOT_STARTED });

            await crawler.getQuizzes("53380");

            const viewRequests = mockFetch.mock.calls
                .map(([url]) => requestPath(url))
                .filter((url) => url.startsWith("/mod/quiz/view.php"));
            expect(viewRequests).toEqual(["/mod/quiz/view.php?id=709855"]);
        });

        it("falls back to 'unknown' when a quiz page cannot be loaded", async () => {
            mockSite({});

            const quizzes = await crawler.getQuizzes("53380");

            expect(quizzes.find((q) => q.id === "709855")?.attemptStatus).toBe(
                "unknown"
            );
        });
    });

    describe("quiz availability (closed / not yet open / restricted)", () => {
        const RESTRICTIONS = fixture("course_view_restrictions.html");
        const EMPTY_INDEX = `<html><body><table class="generaltable"><tbody></tbody></table></body></html>`;

        function mockRestrictedCourse(): void {
            mockFetch.mockImplementation((input: string | URL) => {
                const url = requestPath(input);
                if (url.startsWith("/mod/quiz/index.php")) {
                    return Promise.resolve(html(EMPTY_INDEX));
                }
                if (url.startsWith("/course/view.php")) {
                    return Promise.resolve(html(RESTRICTIONS));
                }
                if (url === "/mod/quiz/view.php?id=9104") {
                    return Promise.resolve(
                        html(asQuizPage(VIEW_NOT_STARTED, "9104"))
                    );
                }
                return Promise.reject(new Error(`Unexpected request: ${url}`));
            });
        }

        it("getQuizzes tells closed, not-yet-open and restricted quizzes apart", async () => {
            mockRestrictedCourse();

            const quizzes = await crawler.getQuizzes("90000");

            expect(
                quizzes.map((q) => [
                    q.id,
                    q.availability,
                    q.opensAt,
                    q.closesAt,
                    q.attemptStatus,
                ])
            ).toEqual([
                [
                    "9101",
                    "closed",
                    "",
                    "07 September 2026, 23:55 PM",
                    "unavailable",
                ],
                [
                    "9102",
                    "not_yet_open",
                    "03 November 2026, 9:00 AM",
                    "",
                    "unavailable",
                ],
                ["9103", "restricted", "", "", "unavailable"],
                ["9104", "available", "", "", "not_started"],
                [
                    "9105",
                    "not_yet_open",
                    "2026년 11월 3일, 오전 9:00",
                    "",
                    "unavailable",
                ],
                [
                    "9106",
                    "closed",
                    "",
                    "2026년 9월 7일, 오후 11:55",
                    "unavailable",
                ],
                ["9107", "closed", "", "2026년 9월 7일", "unavailable"],
                ["9108", "restricted", "", "", "unavailable"],
                ["9109", "restricted", "", "", "unavailable"],
                ["9110", "closed", "", "07 September 2026", "unavailable"],
            ]);
        });

        it("getQuizzes never takes a highlighted activity name for a date", async () => {
            mockRestrictedCourse();

            const quizzes = await crawler.getQuizzes("90000");
            const byCondition = quizzes.find((q) => q.id === "9103");

            expect(byCondition?.closesAt).toBe("");
            expect(byCondition?.opensAt).toBe("");
            expect(byCondition?.availabilityInfo).toBe(
                "Not available unless: The activity 퀴즈_4차 is marked complete"
            );
            // Nothing in the list carries the activity name as a date
            expect(
                quizzes.some(
                    (q) =>
                        q.closesAt.includes("퀴즈") ||
                        q.opensAt.includes("퀴즈")
                )
            ).toBe(false);
        });

        it("getQuizzes keeps the site's notice for every unavailable quiz", async () => {
            mockRestrictedCourse();

            const quizzes = await crawler.getQuizzes("90000");

            expect(
                Object.fromEntries(
                    quizzes.map((q) => [q.id, q.availabilityInfo])
                )
            ).toMatchObject({
                "9101": "Available until 07 September 2026, 23:55 PM",
                "9102": "Available from 03 November 2026, 9:00 AM",
                "9104": "",
                "9105": "2026년 11월 3일, 오전 9:00 부터 사용가능",
                "9109": "",
            });
        });

        it("getQuizDetail reports a not-yet-open quiz with an opening date and no close date", async () => {
            mockFetch.mockResolvedValueOnce(html(RESTRICTIONS));

            const quiz = await crawler.getQuizDetail("9102");

            expect(quiz).toMatchObject({
                id: "9102",
                name: "퀴즈_2차",
                openedAt: "03 November 2026, 9:00 AM",
                closedAt: "",
                attemptStatus: "unavailable",
                availability: "not_yet_open",
                availabilityInfo: "Available from 03 November 2026, 9:00 AM",
            });
        });

        it("getQuizDetail reports a quiz restricted by a condition without any date", async () => {
            mockFetch.mockResolvedValueOnce(html(RESTRICTIONS));

            const quiz = await crawler.getQuizDetail("9103");

            expect(quiz).toMatchObject({
                openedAt: "",
                closedAt: "",
                attemptStatus: "unavailable",
                availability: "restricted",
            });
        });

        it("getQuizDetail reports a quiz past its window as closed", async () => {
            mockFetch.mockResolvedValueOnce(html(COURSE_VIEW));

            const quiz = await crawler.getQuizDetail("699361");

            expect(quiz).toMatchObject({
                closedAt: "21 September 2026, 23:55 PM",
                availability: "closed",
            });
        });

        it("getQuizDetail reports an open quiz page as available", async () => {
            mockFetch.mockResolvedValueOnce(html(VIEW_NOT_STARTED));

            const quiz = await crawler.getQuizDetail("709855");

            expect(quiz.availability).toBe("available");
            expect(quiz.availabilityInfo).toBe("");
        });
    });

    // State wording per Moodle's mod_quiz language strings (stateinprogress,
    // stateoverdue[details], statefinished[details], stateabandoned), English
    // and the Korean language pack. The Korean rows are the language pack's
    // strings, not a capture of this site, which is used in English.
    describe("attempt state wording", () => {
        function stateRow(stateHtml: string, review = false): string {
            return `<tr class="lastrow">
<td class="cell c0" style="text-align:left;">${stateHtml}</td>
<td class="cell c1" style="text-align:center;"></td>
<td class="cell c2 lastcol" style="text-align:center;">${review ? '<a href="https://ecampus.kangnam.ac.kr/mod/quiz/review.php?attempt=1">Review</a>' : ""}</td>
</tr>`;
        }
        /** A quiz page whose only attempt has the given state cell. */
        function viewWithState(stateHtml: string, korean: boolean): string {
            const table = summaryTable(stateRow(stateHtml));
            return VIEW_CLOSED_NO_ATTEMPT.replace(
                ATTEMPT_BOX_START,
                (korean ? table.replace(">State</th>", ">상태</th>") : table) +
                    ATTEMPT_BOX_START
            );
        }

        it.each([
            ["en", "abandoned", "Never submitted"],
            ["ko", "abandoned", "제출되지 않았습니다."],
            ["en", "in_progress", "In progress"],
            ["ko", "in_progress", "진행중"],
            [
                "en",
                "in_progress",
                'Overdue<span class="statedetails">Must be submitted by Thursday, 17 September 2026, 3:02 PM</span>',
            ],
            [
                "ko",
                "in_progress",
                '기한 만료<span class="statedetails">2026년 9월 17일 목요일, 오후 3:02가 제출해야 합니다.</span>',
            ],
            [
                "en",
                "finished",
                'Finished<span class="statedetails">Submitted Thursday, 17 September 2026, 3:02 PM</span>',
            ],
            [
                "ko",
                "finished",
                '종료됨<span class="statedetails">2026년 9월 17일 목요일, 오후 3:02를 제출함</span>',
            ],
            ["en", "finished", "Finished"],
            ["ko", "finished", "종료됨"],
        ] as const)(
            "[%s] reads '%s' from the state cell: %s",
            async (lang, expected, stateHtml) => {
                mockFetch.mockResolvedValueOnce(
                    html(viewWithState(stateHtml, lang === "ko"))
                );

                const quiz = await crawler.getQuizDetail("705568");

                expect(quiz.attemptStatus).toBe(expected);
            }
        );

        it("does not guess 'finished' from a state it does not recognise", async () => {
            mockFetch.mockResolvedValueOnce(
                html(viewWithState("Abgegeben?", false))
            );

            const quiz = await crawler.getQuizDetail("705568");

            expect(quiz.attemptStatus).toBe("unknown");
        });

        it.each([
            "Not finished",
            "Unfinished",
            "Not submitted",
            "Not yet submitted",
            "Never finished",
            "완료되지 않음",
            "제출 안 함",
            "미제출",
            "Refinished",
        ])(
            "reads a negated or unknown state as 'unknown': %s",
            async (state) => {
                mockFetch.mockResolvedValueOnce(
                    html(viewWithState(state, false))
                );

                const quiz = await crawler.getQuizDetail("705568");

                expect(quiz.attemptStatus).toBe("unknown");
            }
        );

        it("reads the state, not the details that follow it in the cell", async () => {
            // The details of an overdue attempt contain "submitted"
            mockFetch.mockResolvedValueOnce(
                html(
                    viewWithState(
                        'Verfallen<span class="statedetails">Submitted? Must be submitted by Thursday</span>',
                        false
                    )
                )
            );

            const quiz = await crawler.getQuizDetail("705568");

            expect(quiz.attemptStatus).toBe("unknown");
        });

        // Moodle links the review of every attempt that is no longer open
        // (accessmanager::make_review_link only leaves out in-progress and
        // overdue ones), so an abandoned, never submitted attempt has the
        // link too. It is no evidence of a submission.
        it.each(["Beendet", "Nie abgegeben", "Not finished"])(
            "does not read 'finished' from a review link when the state is '%s'",
            async (state) => {
                mockFetch.mockResolvedValueOnce(
                    html(
                        VIEW_CLOSED_NO_ATTEMPT.replace(
                            ATTEMPT_BOX_START,
                            summaryTable(stateRow(state, true)) +
                                ATTEMPT_BOX_START
                        )
                    )
                );

                const quiz = await crawler.getQuizDetail("705568");

                expect(quiz.attemptStatus).toBe("unknown");
            }
        );

        it("still reads 'abandoned' for a never submitted attempt that has a review link", async () => {
            mockFetch.mockResolvedValueOnce(
                html(
                    VIEW_CLOSED_NO_ATTEMPT.replace(
                        ATTEMPT_BOX_START,
                        summaryTable(stateRow("Never submitted", true)) +
                            ATTEMPT_BOX_START
                    )
                )
            );

            const quiz = await crawler.getQuizDetail("705568");

            expect(quiz.attemptStatus).toBe("abandoned");
        });

        it("reads 'in_progress' from the Korean continue button", async () => {
            mockFetch.mockResolvedValueOnce(
                html(
                    viewWithHistory(
                        summaryTable(stateRow("")).replace(
                            /<tbody>[\s\S]*<\/tbody>/,
                            "<tbody></tbody>"
                        ),
                        "지난번 시도 계속"
                    )
                )
            );

            const quiz = await crawler.getQuizDetail("709855");

            expect(quiz.attemptStatus).toBe("in_progress");
        });
    });

    describe("getQuizDetail requires the page of this quiz", () => {
        it("throws for a course page that does not list the quiz, instead of reporting the course title", async () => {
            // 200, no .errormessage, and no #module-123456 on the page
            mockFetch.mockResolvedValueOnce(html(COURSE_VIEW));

            await expect(crawler.getQuizDetail("123456")).rejects.toThrow(
                "Failed to load quiz 123456"
            );
        });

        it("throws for an unrelated 200 page", async () => {
            mockFetch.mockResolvedValueOnce(
                html(
                    `<html><body id="page-site-index"><div role="main"><h2>강남대학교 e-campus</h2></div></body></html>`
                )
            );

            await expect(crawler.getQuizDetail("709855")).rejects.toThrow(
                "page-site-index"
            );
        });

        it("throws for the view page of another quiz", async () => {
            mockFetch.mockResolvedValueOnce(
                html(asQuizPage(VIEW_NOT_STARTED, "111111"))
            );

            await expect(crawler.getQuizDetail("709855")).rejects.toThrow(
                "Failed to load quiz 709855"
            );
        });

        it("accepts the quiz view page that names this quiz on <body>", async () => {
            mockFetch.mockResolvedValueOnce(
                html(asQuizPage(VIEW_NOT_STARTED, "709855"))
            );

            const quiz = await crawler.getQuizDetail("709855");

            expect(quiz.attemptStatus).toBe("not_started");
            expect(quiz.name).not.toBe("");
        });
    });
    describe("getQuizDetail page identity", () => {
        const BARE = fixture("view_not_started.html");

        it.each([
            ["a body without id and class", "<body>"],
            [
                "a body without the module class",
                '<body id="page-mod-quiz-view">',
            ],
            [
                "a body without the page id",
                '<body class="path-mod cmid-709855">',
            ],
            [
                "the page of another quiz",
                '<body id="page-mod-quiz-view" class="path-mod cmid-709856">',
            ],
            [
                "another page type of this module",
                '<body id="page-mod-quiz-attempt" class="path-mod cmid-709855">',
            ],
        ])("throws for %s", async (_label, body) => {
            mockFetch.mockResolvedValueOnce(
                html(BARE.replace(/<body[^>]*>/, body))
            );

            await expect(crawler.getQuizDetail("709855")).rejects.toThrow(
                "the response is not the page of this quiz"
            );
        });

        it("compares the module id as a number", async () => {
            mockFetch.mockResolvedValueOnce(html(VIEW_NOT_STARTED));

            const quiz = await crawler.getQuizDetail("0709855");

            expect(quiz.attemptStatus).toBe("not_started");
        });
    });

    describe("availability notices", () => {
        const INDEX_WITH_QUIZ = `<html><body><table class="generaltable"><tbody>
            <tr><td>1회차</td><td><a href="https://ecampus.kangnam.ac.kr/mod/quiz/view.php?id=9301">퀴즈</a></td><td>2026-09-07 23:55</td><td></td></tr>
        </tbody></table></body></html>`;

        /** A course page with one dimmed quiz carrying the given notice. */
        function courseWith(noticeHtml: string, cmid = "9201"): string {
            return `<html><body id="page-course-view-ubsweeks" class="path-course-view">
<div role="main"><ul class="weeks"><li id="section-1" class="section main"><h3 class="sectionname">1주차</h3><ul class="section">
<li class="activity quiz modtype_quiz" id="module-${cmid}"><div class="availability dimmed"><div class="availabilityinfo">${noticeHtml}</div><div class="activityinstance"><div class="dimmed_text"><span class="instancename">퀴즈<span class="accesshide"> Quiz</span></span></div></div></div></li>
</ul></li></ul></div></body></html>`;
        }
        async function classify(noticeHtml: string) {
            mockFetch.mockResolvedValueOnce(html(courseWith(noticeHtml)));
            const quiz = await crawler.getQuizDetail("9201");
            return {
                availability: quiz.availability,
                opensAt: quiz.openedAt,
                closesAt: quiz.closedAt,
            };
        }

        beforeEach(() => {
            // Between the two dates used below, unless a test says otherwise
            vi.useFakeTimers({ toFake: ["Date"] });
            vi.setSystemTime(new Date("2026-05-10T12:00:00+09:00"));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it.each([
            [
                "Available until <strong>25 May 2026, 23:55 PM</strong>",
                "closed",
                "",
                "25 May 2026, 23:55 PM",
            ],
            [
                "Available until <strong>25 May 2026</strong> (hidden otherwise)",
                "closed",
                "",
                "25 May 2026",
            ],
            [
                "Available from <strong>1 May 2026</strong> (hidden otherwise)",
                "not_yet_open",
                "1 May 2026",
                "",
            ],
            [
                "<strong>2026년 5월 25일, 오후 11:55</strong>까지 사용가능합니다.",
                "closed",
                "",
                "2026년 5월 25일, 오후 11:55",
            ],
            [
                "<strong>2026년 5월 1일</strong> 부터 사용 가능합니다.",
                "not_yet_open",
                "2026년 5월 1일",
                "",
            ],
            ["Available until 25 May 2026.", "closed", "", "25 May 2026"],
            ["2026-05-25 23:55까지 사용가능", "closed", "", "2026-05-25 23:55"],
            [
                "Not available unless: It is after <strong>1 May 2026</strong>",
                "not_yet_open",
                "1 May 2026",
                "",
            ],
            [
                "Not available unless: It is before end of <strong>25 May 2026</strong>",
                "closed",
                "",
                "25 May 2026",
            ],
        ])("reads %s", async (notice, availability, opensAt, closesAt) => {
            expect(await classify(notice)).toEqual({
                availability,
                opensAt,
                closesAt,
            });
        });

        it.each([
            "Available from <strong>1 May 2026, 9:00 AM</strong><br>Available until <strong>25 May 2026, 23:55 PM</strong>",
            "Available from <strong>1 May 2026, 9:00 AM</strong> until <strong>25 May 2026, 23:55 PM</strong>",
            "Available from 1 May 2026, 9:00 AM until 25 May 2026, 23:55 PM",
            "Not available unless: <ul><li>It is after <strong>1 May 2026, 9:00 AM</strong></li><li>It is before <strong>25 May 2026, 23:55 PM</strong></li></ul>",
        ])("keeps the two dates of %s apart", async (notice) => {
            const result = await classify(notice);

            expect(result.opensAt).toBe("1 May 2026, 9:00 AM");
            expect(result.closesAt).toBe("25 May 2026, 23:55 PM");
        });

        it("keeps a Korean opening and closing date apart", async () => {
            const result = await classify(
                "<strong>2026년 5월 1일, 오전 9:00</strong> 부터 사용가능<br><strong>2026년 5월 25일, 오후 11:55</strong>까지 사용가능"
            );

            expect(result).toMatchObject({
                opensAt: "2026년 5월 1일, 오전 9:00",
                closesAt: "2026년 5월 25일, 오후 11:55",
            });
        });

        describe("a notice with both dates", () => {
            const BOTH =
                "Available from <strong>1 May 2026, 9:00 AM</strong><br>Available until <strong>25 May 2026, 23:55 PM</strong>";

            it.each([
                ["2026-05-01T08:59:00+09:00", "not_yet_open"],
                ["2026-05-01T09:01:00+09:00", "restricted"],
                ["2026-05-25T23:54:00+09:00", "restricted"],
                ["2026-05-25T23:56:00+09:00", "closed"],
            ])("at %s is %s", async (now, availability) => {
                vi.setSystemTime(new Date(now));

                expect((await classify(BOTH)).availability).toBe(availability);
            });

            it("closes at the end of a closing day that has no time", async () => {
                const notice =
                    "Available from <strong>1 May 2026</strong><br>Available until end of <strong>25 May 2026</strong>";

                vi.setSystemTime(new Date("2026-05-25T23:00:00+09:00"));
                expect((await classify(notice)).availability).toBe(
                    "restricted"
                );
                vi.setSystemTime(new Date("2026-05-26T00:00:30+09:00"));
                expect((await classify(notice)).availability).toBe("closed");
            });

            it("is 'restricted', with both dates, when a date cannot be placed in time", async () => {
                expect(
                    await classify(
                        "Available from <strong>May 2026</strong> until <strong>25 May 2026</strong>"
                    )
                ).toEqual({
                    availability: "restricted",
                    opensAt: "May 2026",
                    closesAt: "25 May 2026",
                });
            });
        });

        it.each([
            "성적이 60점이 될 때까지 사용가능",
            "<strong>성적이 60점이 될 때</strong>까지 사용가능",
            "Available until <strong>you finish 퀴즈_1차</strong>",
            "Available until further notice",
            "Available from <strong>1 May 2026</strong> and you have a grade in <strong>퀴즈_1차</strong>",
            "Not available unless: <ul><li>It is after <strong>1 May 2026</strong></li><li>The activity <strong>2026 Midterm</strong> is marked complete</li></ul>",
            "Available from <strong>1 May 2026</strong><br>Available from <strong>3 May 2026</strong>",
            "<strong>25 May 2026</strong>",
            "Not available unless: It is not after <strong>1 May 2026</strong>",
            "",
        ])("is 'restricted' without a date for: %s", async (notice) => {
            expect(await classify(notice)).toEqual({
                availability: "restricted",
                opensAt: "",
                closesAt: "",
            });
        });

        it("getQuizzes takes the availability of a listed quiz from the course page it is sent back to", async () => {
            // In the index (so "available" at first), but view.php answers
            // with the course page, where the quiz is dimmed.
            const course = courseWith(
                "Available until <strong>07 September 2026, 23:55 PM</strong>",
                "9301"
            );
            mockFetch.mockImplementation((input: string | URL) => {
                const url = requestPath(input);
                if (url.startsWith("/mod/quiz/index.php")) {
                    return Promise.resolve(html(INDEX_WITH_QUIZ));
                }
                return Promise.resolve(html(course));
            });

            const [quiz] = await crawler.getQuizzes("90000");

            expect(quiz).toMatchObject({
                id: "9301",
                attemptStatus: "unavailable",
                availability: "closed",
                availabilityInfo: "Available until 07 September 2026, 23:55 PM",
                opensAt: "",
                closesAt: "07 September 2026, 23:55 PM",
            });
        });

        it("getQuizzes keeps the index's closing date when the notice of such a quiz has none", async () => {
            const course = courseWith(
                "Not available unless: The activity <strong>퀴즈_1차</strong> is marked complete",
                "9301"
            );
            mockFetch.mockImplementation((input: string | URL) => {
                const url = requestPath(input);
                if (url.startsWith("/mod/quiz/index.php")) {
                    return Promise.resolve(html(INDEX_WITH_QUIZ));
                }
                return Promise.resolve(html(course));
            });

            const [quiz] = await crawler.getQuizzes("90000");

            expect(quiz).toMatchObject({
                attemptStatus: "unavailable",
                availability: "restricted",
                availabilityInfo:
                    "Not available unless: The activity 퀴즈_1차 is marked complete",
                closesAt: "2026-09-07 23:55",
            });
        });
    });
});
