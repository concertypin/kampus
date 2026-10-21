import { describe, expect, it, beforeEach, vi } from "vitest";
import { Crawler, isEcampusUrl } from "@/crawler";
import { MemoryStorage } from "@/storage/memory";
import { fetchWithBase } from "@/client";

vi.mock("@/client", () => ({
    BASE_URL: "https://ecampus.kangnam.ac.kr",
    fetchWithBase: vi.fn<typeof fetchWithBase>(),
}));

const mockFetch = vi.mocked(fetchWithBase);

const BASE = "https://ecampus.kangnam.ac.kr";
const OWN_FILE = `${BASE}/pluginfile.php/10/mod_ubfile/content/0/own.pdf`;
const FOREIGN_FILE =
    "https://files.example.com/pluginfile.php/10/mod_ubfile/content/0/foreign.pdf";

/**
 * File URLs returned by the library are fetched with the session cookie, so
 * none of them may point anywhere but the e-campus (https).
 */
describe("file URLs stay on the e-campus origin", () => {
    let crawler: Crawler;

    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockReset();
        crawler = new Crawler({ storage: new MemoryStorage() });
    });

    describe("isEcampusUrl", () => {
        it("accepts only the https e-campus origin", () => {
            expect(isEcampusUrl(OWN_FILE)).toBe(true);
            expect(isEcampusUrl(new URL(OWN_FILE))).toBe(true);
            expect(isEcampusUrl(FOREIGN_FILE)).toBe(false);
            expect(isEcampusUrl(OWN_FILE.replace("https:", "http:"))).toBe(
                false
            );
            expect(
                isEcampusUrl(
                    "https://ecampus.kangnam.ac.kr:8443/pluginfile.php"
                )
            ).toBe(false);
            expect(
                isEcampusUrl(
                    "https://ecampus.kangnam.ac.kr.example.com/pluginfile.php"
                )
            ).toBe(false);
            expect(
                isEcampusUrl(
                    "https://example.com/@ecampus.kangnam.ac.kr/pluginfile.php"
                )
            ).toBe(false);
            expect(isEcampusUrl("/pluginfile.php/1/a.pdf")).toBe(false);
        });
    });

    describe("getResourceDetail", () => {
        it("does not report an off-origin 303 Location as a file", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response("", {
                    status: 303,
                    headers: { Location: FOREIGN_FILE },
                })
            );

            await expect(crawler.getResourceDetail("479453")).rejects.toThrow(
                "files.example.com"
            );
            // Nothing is requested on behalf of the foreign URL either
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("does not report an http (non-https) Location as a file", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response("", {
                    status: 303,
                    headers: {
                        Location: OWN_FILE.replace("https:", "http:"),
                    },
                })
            );

            await expect(crawler.getResourceDetail("479454")).rejects.toThrow(
                "http://ecampus.kangnam.ac.kr"
            );
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("leaves out off-origin links written in the page body", async () => {
            const html = `
                <html><body id="page-mod-ubfile-view" class="path-mod cmid-479455">
                    <div role="main">
                        <h2>자료</h2>
                        <div id="intro">
                            <a href="${FOREIGN_FILE}">foreign.pdf</a>
                            <a href="//files.example.com/pluginfile.php/1/x/protocol-relative.pdf">p.pdf</a>
                            <a href="http://ecampus.kangnam.ac.kr/pluginfile.php/1/x/plain-http.pdf">h.pdf</a>
                        </div>
                        <a href="${OWN_FILE}">own.pdf</a>
                    </div>
                </body></html>`;
            mockFetch.mockResolvedValueOnce(
                new Response(html, {
                    status: 200,
                    headers: { "Content-Type": "text/html; charset=utf-8" },
                })
            );

            const detail = await crawler.getResourceDetail("479455");

            expect(detail.files.map((f) => f.url)).toEqual([OWN_FILE]);
        });
    });

    describe("getAssignmentDetail", () => {
        it("leaves out off-origin links in the intro and the submission row", async () => {
            const html = `
                <html><body>
                    <div role="main"><h2>과제</h2></div>
                    <div id="intro">
                        <a href="${FOREIGN_FILE}">foreign.pdf</a>
                        <a href="${OWN_FILE}">own.pdf</a>
                    </div>
                    <div class="submissionstatustable">
                        <table class="generaltable"><tbody>
                            <tr>
                                <td>File submissions</td>
                                <td>
                                    <a href="https://files.example.com/pluginfile.php/2/assignsubmission_file/a.hwp">a.hwp</a>
                                    <a href="${BASE}/pluginfile.php/2/assignsubmission_file/submission_files/9/mine.hwp">mine.hwp</a>
                                </td>
                            </tr>
                        </tbody></table>
                    </div>
                </body></html>`;
            mockFetch.mockResolvedValueOnce(
                new Response(html, { status: 200 })
            );

            const detail = await crawler.getAssignmentDetail("600001");

            expect(detail.files).toEqual([
                { name: "own.pdf", url: OWN_FILE },
                {
                    name: "mine.hwp",
                    url: `${BASE}/pluginfile.php/2/assignsubmission_file/submission_files/9/mine.hwp`,
                },
            ]);
        });
    });

    describe("getAssignmentDetail relative links", () => {
        it("returns absolute URLs for relative file links", async () => {
            const html = `
                <html><body>
                    <div role="main"><h2>과제</h2></div>
                    <div id="intro">
                        <a href="/pluginfile.php/10/mod_assign/intro/guide.pdf">guide.pdf</a>
                    </div>
                </body></html>`;
            mockFetch.mockResolvedValueOnce(
                new Response(html, { status: 200 })
            );

            const detail = await crawler.getAssignmentDetail("600002");

            expect(detail.files).toEqual([
                {
                    name: "guide.pdf",
                    url: `${BASE}/pluginfile.php/10/mod_assign/intro/guide.pdf`,
                },
            ]);
        });
    });

    describe("getBoardPostDetail", () => {
        it("leaves out off-origin attachment links", async () => {
            const html = `
                <html><body>
                    <div class="ubboard_view">
                        <div class="subject">제목</div>
                        <div class="content"><div class="text_to_html">본문</div></div>
                        <ul class="files">
                            <li><a href="${FOREIGN_FILE}">foreign.pdf</a></li>
                            <li><a href="${OWN_FILE}">own.pdf</a></li>
                        </ul>
                    </div>
                </body></html>`;
            mockFetch.mockResolvedValueOnce(
                new Response(html, { status: 200 })
            );

            const detail = await crawler.getBoardPostDetail("442287", "1");

            expect(detail.files).toEqual([{ name: "own.pdf", url: OWN_FILE }]);
        });
    });
});
