import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { Crawler } from "@/crawler";
import { MemoryStorage } from "@/storage/memory";
import { fetchWithBase } from "@/client";

vi.mock("@/client", () => ({
    BASE_URL: "https://ecampus.kangnam.ac.kr",
    fetchWithBase: vi.fn<typeof fetchWithBase>(),
}));

const mockFetch = vi.mocked(fetchWithBase);

/** The path and query of a request the crawler handed to `fetchWithBase`. */
function requestPath(input: string | URL): string {
    const url = new URL(input, "https://ecampus.kangnam.ac.kr");
    return url.pathname + url.search;
}

function fixture(name: string): string {
    return readFileSync(
        join(import.meta.dirname, "..", "fixtures", "activities", name),
        "utf8"
    );
}

function respondWith(...bodies: string[]): void {
    for (const body of bodies) {
        mockFetch.mockResolvedValueOnce(new Response(body, { status: 200 }));
    }
}

const EMPTY_ATTENDANCE = "<html><body></body></html>";

describe("Crawler course activities", () => {
    let crawler: Crawler;

    beforeEach(() => {
        vi.clearAllMocks();
        crawler = new Crawler({ storage: new MemoryStorage() });
    });

    describe("repeated current week", () => {
        it("getWeeklyActivities lists the current week once, at its place in the week order", async () => {
            respondWith(fixture("course-current-week.html"));

            const weeks = await crawler.getWeeklyActivities("90000");

            expect(weeks.map((w) => w.weekId)).toEqual([
                "section-0",
                "section-1",
                "section-2",
                "section-3",
            ]);
            expect(weeks.map((w) => w.weekTitle)).toEqual([
                "개요",
                "1주차",
                "2주차",
                "3주차",
            ]);
            expect(weeks.flatMap((w) => w.activities.map((a) => a.id))).toEqual(
                ["9001", "9101", "9102", "9201", "9202"]
            );
        });

        it("getResources lists a current-week resource once", async () => {
            respondWith(fixture("course-current-week.html"));

            const resources = await crawler.getResources("90000");

            expect(resources.map((r) => r.id)).toEqual(["9102", "9202"]);
        });

        it("getVods lists a current-week VOD once, in week order", async () => {
            respondWith(EMPTY_ATTENDANCE, fixture("course-current-week.html"));

            const vods = await crawler.getVods("90000");

            expect(vods.map((v) => v.id)).toEqual(["9101", "9201"]);
            expect(vods.map((v) => v.week)).toEqual([1, 2]);
        });

        it("keeps a week that only appears in the highlight box", async () => {
            const html = fixture("course-current-week.html");
            const onlyHighlight = html.slice(
                0,
                html.indexOf('<div class="total_sections">')
            );
            respondWith(`${onlyHighlight}</div></body></html>`);

            const weeks = await crawler.getWeeklyActivities("90000");

            expect(weeks.map((w) => w.weekId)).toEqual([
                "section-0",
                "section-2",
            ]);
        });
    });

    describe("restricted (link-less) activities", () => {
        it("getWeeklyActivities keeps them with an empty url and available=false", async () => {
            respondWith(fixture("course-restricted.html"));

            const [week] = await crawler.getWeeklyActivities("80000");

            expect(week?.activities).toEqual([
                {
                    id: "8101",
                    type: "vod",
                    name: "1주차 영상",
                    url: "",
                    available: false,
                    availabilityInfo:
                        "Available until 07 September 2026, 23:55 PM",
                },
                {
                    id: "8102",
                    type: "quiz",
                    name: "퀴즈_1차",
                    // The link inside the description is not the activity link
                    url: "",
                    available: false,
                    availabilityInfo:
                        "Available until 07 September 2026, 23:55 PM",
                },
                {
                    id: "8104",
                    type: "ubfile",
                    name: "기말 범위 안내",
                    url: "",
                    available: false,
                    availabilityInfo:
                        "Available from 01 December 2026, 00:00 AM",
                },
                {
                    id: "8105",
                    type: "ubfile",
                    name: "1주차 강의노트",
                    url: "https://ecampus.kangnam.ac.kr/mod/ubfile/view.php?id=8105",
                    available: true,
                    availabilityInfo: "",
                },
            ]);
        });

        it("getWeeklyActivities leaves out labels, which are inline text rather than activities", async () => {
            respondWith(fixture("course-restricted.html"));

            const weeks = await crawler.getWeeklyActivities("80000");

            expect(
                weeks.flatMap((w) => w.activities.map((a) => a.id))
            ).not.toContain("8103");
        });

        it("getVods keeps a restricted VOD with an empty url, not its description link", async () => {
            respondWith(EMPTY_ATTENDANCE, fixture("course-restricted.html"));

            const vods = await crawler.getVods("80000");

            expect(vods.map((v) => [v.id, v.url])).toEqual([["8101", ""]]);
        });

        it("getResources lists a restricted resource and marks it unavailable", async () => {
            respondWith(fixture("course-restricted.html"));

            const resources = await crawler.getResources("80000");

            expect(resources).toEqual([
                expect.objectContaining({
                    id: "8104",
                    url: "",
                    available: false,
                    availabilityInfo:
                        "Available from 01 December 2026, 00:00 AM",
                }),
                expect.objectContaining({
                    id: "8105",
                    available: true,
                    availabilityInfo: "",
                }),
            ]);
        });
    });

    // The four standard Moodle types below have no live instance on the
    // account the other fixtures were captured from: these fixtures are built
    // from Moodle's stock markup, not captured from the site.
    describe("module types (standard Moodle fixtures, not live-captured)", () => {
        it("getWeeklyActivities reports every modtype_* generically", async () => {
            respondWith(fixture("moodle-standard-course.html"));

            const [week] = await crawler.getWeeklyActivities("70000");

            expect(week?.activities.map((a) => [a.id, a.type, a.name])).toEqual(
                [
                    ["7101", "resource", "강의계획 요약"],
                    ["7102", "folder", "참고자료 모음"],
                    ["7103", "url", "참고 사이트"],
                    ["7104", "page", "수업 운영 안내"],
                    ["7106", "ubfile", "1주차 강의노트"],
                    ["7107", "assign", "1주차 과제"],
                    ["7108", "zoom", "실시간 강의"],
                ]
            );
        });

        it("getWeeklyActivities falls back to 'other' without a modtype_ class", async () => {
            respondWith(`<html><body><ul>
                <li class="section main" id="section-1">
                    <div class="sectionname">1주차</div>
                    <ul><li class="activity" id="module-1">
                        <div class="activityinstance"><a href="https://ecampus.kangnam.ac.kr/mod/x/view.php?id=1"><span class="instancename">이름</span></a></div>
                    </li></ul>
                </li>
            </ul></body></html>`);

            const [week] = await crawler.getWeeklyActivities("70000");

            expect(week?.activities.map((a) => a.type)).toEqual(["other"]);
        });

        it("getResources lists resource, folder, url and page next to ubfile, each with its type, and no label", async () => {
            respondWith(fixture("moodle-standard-course.html"));

            const resources = await crawler.getResources("70000");

            expect(resources.map((r) => [r.id, r.type])).toEqual([
                ["7101", "resource"],
                ["7102", "folder"],
                ["7103", "url"],
                ["7104", "page"],
                ["7106", "ubfile"],
            ]);
            expect(resources[2]?.url).toBe(
                "https://ecampus.kangnam.ac.kr/mod/url/view.php?id=7103"
            );
            expect(resources.every((r) => r.available)).toBe(true);
        });

        it("getResourceDetail resolves a mod/resource 303 to its pluginfile", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(null, {
                    status: 303,
                    headers: {
                        Location:
                            "https://ecampus.kangnam.ac.kr/pluginfile.php/4320/mod_resource/content/2/%EA%B0%95%EC%9D%98%EA%B3%84%ED%9A%8D.pdf",
                    },
                })
            );

            const detail = await crawler.getResourceDetail("7101", "resource");

            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(requestPath(mockFetch.mock.calls[0]?.[0] ?? "")).toBe(
                "/mod/resource/view.php?id=7101"
            );
            expect(detail.files).toEqual([
                {
                    name: "강의계획.pdf",
                    url: "https://ecampus.kangnam.ac.kr/pluginfile.php/4320/mod_resource/content/2/%EA%B0%95%EC%9D%98%EA%B3%84%ED%9A%8D.pdf",
                },
            ]);
        });

        it("getResourceDetail reads the file link of a mod/resource page that does not redirect", async () => {
            respondWith(fixture("moodle-resource-view.html"));

            const detail = await crawler.getResourceDetail("7101", "resource");

            expect(detail.name).toBe("강의계획 요약");
            expect(detail.files.map((f) => f.name)).toEqual(["강의계획.pdf"]);
        });

        it("getResourceDetail lists every file of a mod/folder page", async () => {
            respondWith(fixture("moodle-folder-view.html"));

            const detail = await crawler.getResourceDetail("7102", "folder");

            expect(requestPath(mockFetch.mock.calls[0]?.[0] ?? "")).toBe(
                "/mod/folder/view.php?id=7102"
            );
            expect(detail.name).toBe("참고자료 모음");
            expect(detail.description).toBe("수업 참고자료입니다.");
            expect(detail.files.map((f) => f.name)).toEqual([
                "appendix.xlsx",
                "참고문헌.pdf",
                "slides.pptx",
            ]);
            expect(
                detail.files.every((f) =>
                    f.url.includes("/pluginfile.php/4321/mod_folder/content/")
                )
            ).toBe(true);
        });

        it.each(["url", "page"] as const)(
            "getResourceDetail rejects a '%s' resource without a request, since it has no file",
            async (type) => {
                await expect(
                    crawler.getResourceDetail("7103", type)
                ).rejects.toThrow("다운로드할 파일이 없습니다");
                expect(mockFetch).not.toHaveBeenCalled();
            }
        );

        it("getResourceDetail still defaults to ubfile", async () => {
            respondWith(
                "<html><body id='page-mod-ubfile-view' class='cmid-7106'><div role='main'><h2>x</h2></div></body></html>"
            );

            await crawler.getResourceDetail("7106");

            expect(requestPath(mockFetch.mock.calls[0]?.[0] ?? "")).toBe(
                "/mod/ubfile/view.php?id=7106"
            );
        });
    });

    describe("getResourceDetail only reads the resource itself", () => {
        const OTHER_MODULE_FILE =
            "https://ecampus.kangnam.ac.kr/pluginfile.php/999/mod_folder/content/0/other-module.pdf";
        /** The restricted course page, with another module's file linked on it. */
        function coursePage(bodyAttrs = ""): string {
            return fixture("course-restricted.html")
                .replace("<body>", `<body${bodyAttrs}><div role="main">`)
                .replace(
                    '<div class="course-content">',
                    `<div class="course-content"><a href="${OTHER_MODULE_FILE}">other-module.pdf</a>`
                )
                .replace("</body>", "</div></body>");
        }
        function redirectTo(location: string, status = 303): Response {
            return new Response("", {
                status,
                headers: { Location: location },
            });
        }
        function page(body: string, status = 200): Response {
            return new Response(body, {
                status,
                headers: { "Content-Type": "text/html; charset=utf-8" },
            });
        }

        it("reports a resource that redirects to the course page as unavailable, without that page's files", async () => {
            mockFetch
                .mockResolvedValueOnce(
                    redirectTo(
                        "https://ecampus.kangnam.ac.kr/course/view.php?id=80000"
                    )
                )
                .mockResolvedValueOnce(page(coursePage()));

            const detail = await crawler.getResourceDetail("8104");

            expect(
                mockFetch.mock.calls.map(([url]) => requestPath(url))
            ).toEqual([
                "/mod/ubfile/view.php?id=8104",
                "/course/view.php?id=80000",
            ]);
            expect(detail).toEqual({
                id: "8104",
                name: "기말 범위 안내",
                description: "",
                files: [],
                available: false,
                availabilityInfo: "Available from 01 December 2026, 00:00 AM",
            });
        });

        it("reports a course page served in place of the resource as unavailable too", async () => {
            mockFetch.mockResolvedValueOnce(
                page(
                    coursePage(
                        ' id="page-course-view-ubsweeks" class="path-course course-80000"'
                    )
                )
            );

            const detail = await crawler.getResourceDetail("8104");

            expect(detail.available).toBe(false);
            expect(detail.files).toEqual([]);
        });

        it("throws when the course page it is sent to does not list the resource", async () => {
            mockFetch
                .mockResolvedValueOnce(
                    redirectTo(
                        "https://ecampus.kangnam.ac.kr/course/view.php?id=80000"
                    )
                )
                .mockResolvedValueOnce(page(coursePage()));

            await expect(crawler.getResourceDetail("9999")).rejects.toThrow(
                "강의자료 9999"
            );
        });

        it("does not take files from the view page of another module", async () => {
            // Same page type, but Moodle says it belongs to cmid 7102
            mockFetch.mockResolvedValueOnce(
                page(fixture("moodle-folder-view.html"))
            );

            await expect(
                crawler.getResourceDetail("7999", "folder")
            ).rejects.toThrow("이 자료의 페이지가 아닌");
        });

        it("does not take files from a page that does not say which page it is", async () => {
            mockFetch.mockResolvedValueOnce(
                page(
                    `<html><body><div role="main"><h2>?</h2><a href="${OTHER_MODULE_FILE}">other-module.pdf</a></div></body></html>`
                )
            );

            await expect(crawler.getResourceDetail("8105")).rejects.toThrow(
                "이 자료의 페이지가 아닌"
            );
        });

        it("throws on Moodle's 'Invalid course module ID' error page", async () => {
            mockFetch.mockResolvedValueOnce(
                page(
                    `<html><body id="page-mod-ubfile-view"><div role="main"><span id="maincontent"></span><div class="alert alert-danger" data-rel="fatalerror"><p class="errormessage">Invalid course module ID</p></div></div></body></html>`,
                    404
                )
            );

            await expect(crawler.getResourceDetail("472336")).rejects.toThrow(
                "Invalid course module ID"
            );
        });

        it("throws on an error status without a readable message", async () => {
            mockFetch.mockResolvedValueOnce(
                page("<html><body></body></html>", 500)
            );

            await expect(crawler.getResourceDetail("8105")).rejects.toThrow(
                "HTTP 500"
            );
        });

        it.each([301, 302, 307, 308])(
            "resolves a %i redirect to pluginfile like a 303",
            async (status) => {
                const file =
                    "https://ecampus.kangnam.ac.kr/pluginfile.php/4320/mod_resource/content/2/a.pdf";
                mockFetch.mockResolvedValueOnce(redirectTo(file, status));

                const detail = await crawler.getResourceDetail(
                    "7101",
                    "resource"
                );

                expect(mockFetch).toHaveBeenCalledTimes(1);
                expect(detail.files).toEqual([{ name: "a.pdf", url: file }]);
                expect(detail.available).toBe(true);
            }
        );

        it.each([
            "application/json",
            "application/json; charset=utf-8",
            "application/problem+json",
            "application/xml",
        ])("does not report a 200 '%s' body as a file", async (contentType) => {
            mockFetch.mockResolvedValueOnce(
                new Response('{"error":"nope"}', {
                    status: 200,
                    headers: { "Content-Type": contentType },
                })
            );

            await expect(crawler.getResourceDetail("8105")).rejects.toThrow(
                "예상하지 못한 응답"
            );
        });

        it("still reports a JSON file that is served as a download", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response("{}", {
                    status: 200,
                    headers: {
                        "Content-Type": "application/json",
                        "Content-Disposition":
                            'attachment; filename="data.json"',
                    },
                })
            );

            const detail = await crawler.getResourceDetail("8105");

            expect(detail.files.map((f) => f.name)).toEqual(["data.json"]);
        });

        it("does not take a path that merely contains pluginfile.php for a file", async () => {
            mockFetch.mockResolvedValueOnce(
                redirectTo(
                    "https://ecampus.kangnam.ac.kr/mod/url/view.php/pluginfile.php?id=9"
                )
            );

            await expect(crawler.getResourceDetail("8105")).rejects.toThrow(
                "파일이 아닌 다른 페이지(/mod/url/view.php/pluginfile.php)"
            );
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("leaves out page links whose path merely contains pluginfile.php", async () => {
            mockFetch.mockResolvedValueOnce(
                page(`<html><body id="page-mod-ubfile-view" class="path-mod cmid-8105">
                    <div role="main"><h2>자료</h2>
                        <a href="/mod/url/view.php/pluginfile.php?id=9">not a file</a>
                        <a href="/x.php?next=/pluginfile.php/1/mod_x/content/0/b.pdf">not a file</a>
                        <a href="/pluginfile.php/1/mod_ubfile/content/0/a.pdf">a.pdf</a>
                    </div></body></html>`)
            );

            const detail = await crawler.getResourceDetail("8105");

            expect(detail.files).toEqual([
                {
                    name: "a.pdf",
                    url: "https://ecampus.kangnam.ac.kr/pluginfile.php/1/mod_ubfile/content/0/a.pdf",
                },
            ]);
        });

        describe("redirect response without a Location header", () => {
            const OWN_FILE =
                "https://ecampus.kangnam.ac.kr/pluginfile.php/10/mod_ubfile/content/0/own.pdf";
            function redirectPage(body: string): Response {
                return new Response(`<html><body>${body}</body></html>`, {
                    status: 303,
                    headers: { "Content-Type": "text/html; charset=utf-8" },
                });
            }

            it("takes the continue link only, not the other file links of the page", async () => {
                mockFetch.mockResolvedValueOnce(
                    redirectPage(
                        `<a href="${OTHER_MODULE_FILE}">other-module.pdf</a>
                         <div class="continuebutton">(<a href="${OWN_FILE}">Continue</a>)</div>
                         <a href="${OTHER_MODULE_FILE}?x=1">again</a>`
                    )
                );

                const detail = await crawler.getResourceDetail("8105");

                expect(detail.files).toEqual([
                    { name: "own.pdf", url: OWN_FILE },
                ]);
            });

            it("takes no file when several links could be the target", async () => {
                mockFetch.mockResolvedValueOnce(
                    redirectPage(
                        `<a href="${OTHER_MODULE_FILE}">other-module.pdf</a>
                         <a href="${OWN_FILE}">own.pdf</a>`
                    )
                );

                await expect(crawler.getResourceDetail("8105")).rejects.toThrow(
                    "대상이 없는 리다이렉트(HTTP 303)"
                );
            });

            it("treats a continue link to the course page like a Location to it", async () => {
                mockFetch
                    .mockResolvedValueOnce(
                        redirectPage(
                            `<div class="continuebutton"><a href="https://ecampus.kangnam.ac.kr/course/view.php?id=80000">Continue</a></div>`
                        )
                    )
                    .mockResolvedValueOnce(page(coursePage()));

                const detail = await crawler.getResourceDetail("8104");

                expect(detail.available).toBe(false);
                expect(detail.files).toEqual([]);
            });
        });

        it.each([
            `<meta http-equiv="refresh" content="0; url=http://[bad">`,
            `<meta http-equiv="refresh" content="0; url=https://exa mple.com/x">`,
        ])(
            "reports a malformed redirect target as its own error (%s)",
            async (meta) => {
                mockFetch.mockResolvedValueOnce(
                    page(`<html><head>${meta}</head><body></body></html>`)
                );

                const error: unknown = await crawler
                    .getResourceDetail("8105")
                    .catch((err: unknown) => err);

                expect(error).toBeInstanceOf(Error);
                expect(error).not.toBeInstanceOf(TypeError);
                expect((error as Error).message).toContain(
                    "강의자료 8105을(를) 불러올 수 없습니다: 이동할 주소를 해석할 수 없습니다."
                );
            }
        );

        describe("page identity", () => {
            const FILE =
                "https://ecampus.kangnam.ac.kr/pluginfile.php/1/mod_ubfile/content/0/a.pdf";
            function viewPage(bodyAttrs: string): Response {
                return page(
                    `<html><body ${bodyAttrs}><div role="main"><h2>자료</h2><a href="${FILE}">a.pdf</a></div></body></html>`
                );
            }

            it.each([
                ["the same id", "8105", "cmid-8105"],
                ["a zero-padded request id", "08105", "cmid-8105"],
                ["a zero-padded page id", "8105", "cmid-008105"],
            ])("accepts %s", async (_label, requested, cmidClass) => {
                mockFetch.mockResolvedValueOnce(
                    viewPage(
                        `id="page-mod-ubfile-view" class="path-mod ${cmidClass} lang-ko"`
                    )
                );

                const detail = await crawler.getResourceDetail(requested);

                expect(detail.files).toEqual([{ name: "a.pdf", url: FILE }]);
            });

            it.each([
                [
                    "another module",
                    `id="page-mod-ubfile-view" class="path-mod cmid-8106"`,
                ],
                [
                    "another page type",
                    `id="page-mod-folder-view" class="path-mod cmid-8105"`,
                ],
                [
                    "no module class",
                    `id="page-mod-ubfile-view" class="path-mod"`,
                ],
                ["no page id", `class="path-mod cmid-8105"`],
                ["neither", ``],
                [
                    "a module id that only starts the same",
                    `id="page-mod-ubfile-view" class="path-mod cmid-81050"`,
                ],
            ])("rejects a page stating %s", async (_label, bodyAttrs) => {
                mockFetch.mockResolvedValueOnce(viewPage(bodyAttrs));

                await expect(crawler.getResourceDetail("8105")).rejects.toThrow(
                    "이 자료의 페이지가 아닌"
                );
            });
        });

        describe("mod/resource shown on its own page", () => {
            const IMAGE =
                "https://ecampus.kangnam.ac.kr/pluginfile.php/901/mod_resource/content/3/diagram.png";

            it("reports an embedded image, which has no link", async () => {
                mockFetch.mockResolvedValueOnce(
                    page(`<html><body id="page-mod-resource-view" class="path-mod cmid-7301">
                        <div role="main"><h2>구조도</h2>
                            <div class="resourcecontent resourceimg"><img title="구조도" class="resourceimage" src="${IMAGE}" alt="" /></div>
                            <img class="userpicture" src="https://ecampus.kangnam.ac.kr/pluginfile.php/5/user/icon/f1.png" />
                        </div></body></html>`)
                );

                const detail = await crawler.getResourceDetail(
                    "7301",
                    "resource"
                );

                expect(detail.name).toBe("구조도");
                expect(detail.files).toEqual([
                    { name: "diagram.png", url: IMAGE },
                ]);
            });

            it("reports an embedded PDF object", async () => {
                const pdf =
                    "https://ecampus.kangnam.ac.kr/pluginfile.php/901/mod_resource/content/3/paper.pdf";
                mockFetch.mockResolvedValueOnce(
                    page(`<html><body id="page-mod-resource-view" class="path-mod cmid-7301">
                        <div role="main"><h2>논문</h2>
                            <div class="resourcecontent resourcepdf"><object id="resourceobject" data="${pdf}" type="application/pdf"><param name="src" value="${pdf}" /></object></div>
                        </div></body></html>`)
                );

                const detail = await crawler.getResourceDetail(
                    "7301",
                    "resource"
                );

                expect(detail.files).toEqual([{ name: "paper.pdf", url: pdf }]);
            });

            function frameset(navSrc: string, fileSrc: string): Response {
                return page(`<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Frameset//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-frameset.dtd">
<html dir="ltr"><head><meta http-equiv="content-type" content="text/html; charset=utf-8" /><title>강의 안내</title></head>
<frameset rows="130,*"><frame src="${navSrc}" title="Navigation" /><frame src="${fileSrc}" title="plan.html" /></frameset></html>`);
            }
            const FRAME_FILE =
                "https://ecampus.kangnam.ac.kr/pluginfile.php/901/mod_resource/content/2/plan.html";

            it("reports the file of a frame display, identified by its own navigation frame", async () => {
                mockFetch.mockResolvedValueOnce(
                    frameset(
                        "https://ecampus.kangnam.ac.kr/mod/resource/view.php?id=7301&amp;frameset=top",
                        FRAME_FILE
                    )
                );

                const detail = await crawler.getResourceDetail(
                    "7301",
                    "resource"
                );

                expect(detail).toMatchObject({
                    name: "강의 안내",
                    available: true,
                    files: [{ name: "plan.html", url: FRAME_FILE }],
                });
            });

            it.each([
                [
                    "another module",
                    "https://ecampus.kangnam.ac.kr/mod/resource/view.php?id=7302&amp;frameset=top",
                ],
                [
                    "another host",
                    "https://evil.example/mod/resource/view.php?id=7301&amp;frameset=top",
                ],
                [
                    "another script",
                    "https://ecampus.kangnam.ac.kr/mod/folder/view.php?id=7301&amp;frameset=top",
                ],
            ])(
                "rejects a frameset whose navigation frame is of %s",
                async (_label, navSrc) => {
                    mockFetch.mockResolvedValueOnce(
                        frameset(navSrc, FRAME_FILE)
                    );

                    await expect(
                        crawler.getResourceDetail("7301", "resource")
                    ).rejects.toThrow("이 자료의 페이지가 아닌");
                }
            );
        });
    });

    describe("getResourceDetail file names", () => {
        const FILES =
            "https://ecampus.kangnam.ac.kr/pluginfile.php/55/mod_ubfile/content/0";

        it("names files after the stored file, not a label several links share", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(
                    `<html><body id="page-mod-ubfile-view" class="path-mod cmid-7200">
                        <div role="main"><h2>자료</h2><ul>
                            <li><a href="${FILES}/week1.pdf">다운로드</a></li>
                            <li><a href="${FILES}/week2.pdf">다운로드</a></li>
                            <li><a href="/pluginfile.php?forcedownload=1&amp;file=%2F55%2Fmod_ubfile%2Fcontent%2F0%2F%EC%8B%A4%EC%8A%B5.zip">다운로드</a></li>
                        </ul></div>
                    </body></html>`,
                    { status: 200 }
                )
            );

            const detail = await crawler.getResourceDetail("7200");

            expect(detail.files.map((f) => f.name)).toEqual([
                "week1.pdf",
                "week2.pdf",
                "실습.zip",
            ]);
        });

        it("keeps both of two same-named files in different sub-folders of a folder", async () => {
            const folder =
                "https://ecampus.kangnam.ac.kr/pluginfile.php/56/mod_folder/content/3";
            mockFetch.mockResolvedValueOnce(
                new Response(
                    `<html><body id="page-mod-folder-view" class="path-mod cmid-7201">
                        <div role="main"><h2>폴더</h2>
                            <a href="${folder}/1%EC%A3%BC%EC%B0%A8/notes.pdf?forcedownload=1">notes.pdf</a>
                            <a href="${folder}/2%EC%A3%BC%EC%B0%A8/notes.pdf?forcedownload=1">notes.pdf</a>
                        </div>
                    </body></html>`,
                    { status: 200 }
                )
            );

            const detail = await crawler.getResourceDetail("7201", "folder");

            // Two distinct files (the CLI gives them distinct local names)
            expect(detail.files).toHaveLength(2);
            expect(new Set(detail.files.map((f) => f.url)).size).toBe(2);
            expect(detail.files.map((f) => f.name)).toEqual([
                "notes.pdf",
                "notes.pdf",
            ]);
        });
    });
});
