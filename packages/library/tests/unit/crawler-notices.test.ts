import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeEach, vi } from "vitest";
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

const BASE = "https://ecampus.kangnam.ac.kr";

function fixture(name: string): string {
    return readFileSync(
        join(import.meta.dirname, "..", "fixtures", "notices", name),
        "utf8"
    );
}

function respondWith(...names: string[]): void {
    for (const name of names) {
        mockFetch.mockResolvedValueOnce(
            new Response(fixture(name), { status: 200 })
        );
    }
}

function requestedPaths(): string[] {
    return mockFetch.mock.calls.map((call) => requestPath(call[0]));
}

describe("Crawler notices", () => {
    let crawler: Crawler;

    beforeEach(() => {
        mockFetch.mockReset();
        crawler = new Crawler({ storage: new MemoryStorage() });
    });

    describe("getNoticeBoard", () => {
        it("should pick the board with the notice icon, not the Q&A or custom boards", async () => {
            respondWith("course.html");

            const board = await crawler.getNoticeBoard("52333");

            expect(requestedPaths()).toEqual(["/course/view.php?id=52333"]);
            expect(board).toEqual({
                id: "690359",
                name: "공지사항",
                url: `${BASE}/mod/ubboard/view.php?id=690359`,
            });
        });

        it("should fall back to the announcement widget link when no icon marks the board", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    fixture("course.html").replaceAll(
                        "mod_icon%2Fubboard_notice",
                        "mod_icon%2Fubboard"
                    ),
                    { status: 200 }
                )
            );

            const board = await crawler.getNoticeBoard("52333");

            expect(board?.id).toBe("690359");
        });

        it("should fall back to the board name as a last resort", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    fixture("course.html")
                        .replaceAll(
                            "mod_icon%2Fubboard_notice",
                            "mod_icon%2Fubboard"
                        )
                        .replace('class="more"', 'class="other"'),
                    { status: 200 }
                )
            );

            const board = await crawler.getNoticeBoard("52333");

            expect(board?.id).toBe("690359");
        });

        it("should return null for a course without a board", async () => {
            respondWith("course-no-board.html");

            expect(await crawler.getNoticeBoard("53692")).toBeNull();
        });
    });

    describe("getNotices", () => {
        it("should parse the post list of the notice board", async () => {
            respondWith("course.html", "board-list.html");

            const result = await crawler.getNotices("52333");

            expect(requestedPaths()).toEqual([
                "/course/view.php?id=52333",
                "/mod/ubboard/view.php?id=690359",
            ]);
            expect(result.courseId).toBe("52333");
            expect(result.board?.id).toBe("690359");
            expect(result.totalCount).toBe(3);
            expect(result.page).toBe(1);
            expect(result.totalPages).toBe(1);
            expect(result.notices).toHaveLength(3);
            expect(result.notices[0]).toEqual({
                id: "268544",
                boardId: "690359",
                number: "3",
                title: "[공지] 중간고사 안내",
                author: "Professor A",
                date: "2026-10-12",
                views: 50,
                isPinned: false,
                isNew: true,
                hasAttachment: true,
                isSecret: false,
                url: `${BASE}/mod/ubboard/article.php?id=690359&bwid=268544`,
            });
        });

        it("should read flags and view counts per row", async () => {
            respondWith("course.html", "board-list.html");

            const { notices } = await crawler.getNotices("52333");

            expect(notices.map((n) => n.id)).toEqual([
                "268544",
                "266792",
                "262071",
            ]);
            expect(notices.map((n) => n.isNew)).toEqual([true, false, false]);
            expect(notices.map((n) => n.hasAttachment)).toEqual([
                true,
                false,
                true,
            ]);
            // Thousands separators must not break the number
            expect(notices[1]?.views).toBe(1204);
        });

        it("should return no notices for an empty board", async () => {
            respondWith("course.html", "board-empty.html");

            const result = await crawler.getNotices("53472");

            expect(result.board?.id).toBe("690359");
            expect(result.notices).toEqual([]);
            expect(result.totalCount).toBe(0);
            expect(result.totalPages).toBe(1);
        });

        it("should return a null board without fetching a board page for a course without one", async () => {
            respondWith("course-no-board.html");

            const result = await crawler.getNotices("53692");

            expect(result).toEqual({
                courseId: "53692",
                board: null,
                notices: [],
                totalCount: 0,
                page: 1,
                totalPages: 1,
            });
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });

    describe("getBoardPosts", () => {
        it("should mark pinned posts and leave their number empty", async () => {
            respondWith("board-page1.html");

            const result = await crawler.getBoardPosts("1");

            expect(result.totalPages).toBe(2);
            expect(result.notices.map((n) => n.isPinned)).toEqual([
                true,
                false,
                false,
            ]);
            expect(result.notices[0]).toMatchObject({
                id: "265820",
                number: "",
                title: "원격수업의 학습활동 시간 인정 기준 안내",
                hasAttachment: true,
            });
            expect(result.notices[1]?.number).toBe("4");
        });

        it("should build canonical post URLs without paging parameters", async () => {
            respondWith("board-page2.html");

            const result = await crawler.getBoardPosts("1", {
                page: 2,
                pageSize: 2,
            });

            expect(requestedPaths()).toEqual([
                "/mod/ubboard/view.php?id=1&ls=2&page=2",
            ]);
            expect(result.page).toBe(2);
            expect(result.notices.at(-1)?.url).toBe(
                `${BASE}/mod/ubboard/article.php?id=1&bwid=259915`
            );
        });

        it("should keep hidden posts with an empty id and url", async () => {
            respondWith("board-page2.html");

            const { notices } = await crawler.getBoardPosts("1", { page: 2 });

            expect(notices[1]).toMatchObject({
                id: "",
                url: "",
                number: "2",
                title: "This is a hidden post.",
                isSecret: true,
                isPinned: false,
            });
        });

        it("should merge every page and drop the repeated pinned post when all is set", async () => {
            respondWith("board-page1.html", "board-page2.html");

            const result = await crawler.getBoardPosts("1", { all: true });

            expect(requestedPaths()).toEqual([
                "/mod/ubboard/view.php?id=1",
                "/mod/ubboard/view.php?id=1&page=2",
            ]);
            expect(result.notices.map((n) => n.id)).toEqual([
                "265820",
                "266781",
                "261483",
                "",
                "259915",
            ]);
            expect(result.notices.filter((n) => n.isPinned)).toHaveLength(1);
            expect(result.totalCount).toBe(4);
            expect(result.totalPages).toBe(2);
        });

        it("should list a pinned post without an id (hidden) once when all is set", async () => {
            // The pinned post of both pages, turned into a hidden post: it
            // keeps its "Notice" icon but exposes no link, hence no id.
            const hidePinned = (page: string): string => {
                const hidden = page.replace(
                    /<a href="[^"]*bwid=265820">[^<]*<\/a>/,
                    '<span class="secret">This is a hidden post.</span>'
                );
                expect(hidden).not.toBe(page);
                return hidden;
            };
            for (const name of ["board-page1.html", "board-page2.html"]) {
                mockFetch.mockResolvedValueOnce(
                    new Response(hidePinned(fixture(name)), { status: 200 })
                );
            }

            const result = await crawler.getBoardPosts("1", { all: true });

            expect(
                result.notices.map((n) => [n.id, n.isPinned, n.isSecret])
            ).toEqual([
                ["", true, true],
                ["266781", false, false],
                ["261483", false, false],
                // The ordinary hidden post of page 2 is a different post
                ["", false, true],
                ["259915", false, false],
            ]);
        });

        it("should throw when the board does not exist", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response("<html><body>Not found</body></html>", {
                    status: 404,
                })
            );

            await expect(crawler.getBoardPosts("99999999")).rejects.toThrow(
                "HTTP 404"
            );
        });
    });

    describe("getNoticeDetail", () => {
        it("should parse the post body, metadata and attachments", async () => {
            respondWith("course.html", "article.html");

            const detail = await crawler.getNoticeDetail("52333", "268544");

            expect(requestedPaths()).toEqual([
                "/course/view.php?id=52333",
                "/mod/ubboard/article.php?id=690359&bwid=268544",
            ]);
            expect(detail).toEqual({
                id: "268544",
                boardId: "690359",
                title: "[공지] 중간고사 안내",
                author: "Professor A",
                date: "2026-10-12 09:40",
                views: 51,
                content: [
                    "중간고사를 다음과 같이 실시합니다.",
                    "일시: 2026.10.20(화)",
                    "- 중간고사는 필기 시험으로 진행합니다.",
                    "- 오픈북으로 실시합니다.",
                ].join("\n"),
                files: [
                    {
                        name: "sample.pdf",
                        url: `${BASE}/pluginfile.php?forcedownload=1&file=%2F100000%2Fmod_ubboard%2Fattachment%2F268544%2Fsample.pdf`,
                    },
                ],
                url: `${BASE}/mod/ubboard/article.php?id=690359&bwid=268544`,
            });
        });

        it("should make attachment URLs absolute", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    `<html><body><div class="ubboard_view">
                        <div class="subject">제목</div>
                        <div class="content"><div class="text_to_html">본문</div></div>
                        <ul class="files">
                            <li><a href="/pluginfile.php?forcedownload=1&amp;file=%2F1%2Fmod_ubboard%2Fattachment%2F7%2Fa.pdf">a.pdf</a></li>
                            <li><a href="../../pluginfile.php/1/mod_ubboard/attachment/7/b.pdf">b.pdf</a></li>
                        </ul>
                    </div></body></html>`,
                    { status: 200 }
                )
            );

            const detail = await crawler.getBoardPostDetail("690359", "7");

            expect(detail.files).toEqual([
                {
                    name: "a.pdf",
                    url: `${BASE}/pluginfile.php?forcedownload=1&file=%2F1%2Fmod_ubboard%2Fattachment%2F7%2Fa.pdf`,
                },
                {
                    name: "b.pdf",
                    url: `${BASE}/pluginfile.php/1/mod_ubboard/attachment/7/b.pdf`,
                },
            ]);
        });

        it("should throw with the site's reason when the post does not exist", async () => {
            respondWith("course.html", "article-missing.html");

            await expect(crawler.getNoticeDetail("52333", "1")).rejects.toThrow(
                "No registered post."
            );
        });

        it("should throw when the course has no notice board", async () => {
            respondWith("course-no-board.html");

            await expect(crawler.getNoticeDetail("53692", "1")).rejects.toThrow(
                "공지사항 게시판을 찾을 수 없습니다"
            );
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });
});
