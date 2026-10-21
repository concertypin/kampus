import {
    describe,
    expect,
    it,
    vi,
    beforeEach,
    afterEach,
    type MockInstance,
} from "vitest";
import { Command } from "commander";
import { readCommand } from "@/commands/notices/read";
import { noticesCommand } from "@/commands/notices/index";
import type {
    Crawler,
    LogLevel,
    NoticeDetail,
} from "@concertypin/ecampus-crawler";
import { fragile } from "../../utils";

vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel | undefined>(() => undefined),
}));

const getNoticeDetailMock =
    vi.fn<(courseId: string, postId: string) => Promise<NoticeDetail>>();

const mockCrawler = fragile<Crawler>({
    getNoticeDetail: getNoticeDetailMock,
});

const detail: NoticeDetail = {
    id: "413476",
    boardId: "442287",
    title: "[공지] 중간고사 안내",
    author: "Professor A",
    date: "2026-10-12 09:40",
    views: 51,
    content: "중간고사를 다음과 같이 실시합니다.\n- 오픈북으로 실시합니다.",
    files: [
        {
            name: "sample.pdf",
            url: "https://ecampus.kangnam.ac.kr/pluginfile.php?file=/sample.pdf",
        },
    ],
    url: "https://ecampus.kangnam.ac.kr/mod/ubboard/article.php?id=442287&bwid=413476",
};

async function run(args: string[]): Promise<void> {
    const program = new Command();
    program.addCommand(noticesCommand);
    program.exitOverride();
    await program.parseAsync(args, { from: "user" });
}

function loggedText(spy: { mock: { calls: unknown[][] } }): string {
    return spy.mock.calls.map((call) => call.join(" ")).join("\n");
}

describe("notices read command", () => {
    let logSpy: MockInstance<typeof console.log>;
    let errorSpy: MockInstance<typeof console.error>;

    beforeEach(() => {
        vi.clearAllMocks();
        process.exitCode = undefined;
        // Commander keeps parsed option values on the shared command
        // instances, so reset them between tests.
        noticesCommand.setOptionValue("json", undefined);
        readCommand.setOptionValue("json", undefined);
        logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.exitCode = undefined;
    });

    it("should have correct name and description", () => {
        expect(readCommand.name()).toBe("read");
        expect(readCommand.description()).toContain("공지사항");
    });

    it("should require courseId and postId arguments", () => {
        const args = readCommand.registeredArguments;
        expect(args.map((a) => a.name())).toEqual(["courseId", "postId"]);
        expect(args.every((a) => a.required)).toBe(true);
    });

    it("should print the post body and attachments", async () => {
        getNoticeDetailMock.mockResolvedValue(detail);

        await run(["notices", "read", "365529", "413476"]);

        expect(getNoticeDetailMock).toHaveBeenCalledWith("365529", "413476");
        const out = loggedText(logSpy);
        expect(out).toContain("[공지] 중간고사 안내");
        expect(out).toContain("2026-10-12 09:40");
        expect(out).toContain("- 오픈북으로 실시합니다.");
        expect(out).toContain("sample.pdf");
        expect(out).toContain(detail.files[0]?.url);
    });

    it("should print only parseable JSON with --json", async () => {
        getNoticeDetailMock.mockResolvedValue(detail);

        await run(["notices", "read", "365529", "413476", "--json"]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual(detail);
    });

    it("should set a failing exit code on errors", async () => {
        getNoticeDetailMock.mockRejectedValue(
            new Error("게시글을 불러올 수 없습니다.")
        );

        await run(["notices", "read", "365529", "1"]);

        expect(loggedText(errorSpy)).toContain("게시글을 불러올 수 없습니다.");
        expect(process.exitCode).toBe(1);
    });

    describe("server-provided text on a terminal", () => {
        const ESC = "\u001b";
        const hostile: NoticeDetail = {
            ...detail,
            title: `${ESC}]0;owned\u0007중간고사\u202E 안내`,
            author: `Professor${ESC}[31m A`,
            content: `첫 줄${ESC}[2J\r\n\t둘째 줄\u200B\u009B31m\n셋째 줄`,
            files: [
                {
                    name: `sample${ESC}[8m\u202Efdp.exe`,
                    url: "https://ecampus.kangnam.ac.kr/pluginfile.php?file=/sample.pdf",
                },
            ],
        };

        it("prints no control, escape or bidi characters in text mode", async () => {
            getNoticeDetailMock.mockResolvedValue(hostile);

            await run(["notices", "read", "365529", "413476"]);

            const out = loggedText(logSpy);
            for (const forbidden of [
                ESC,
                "\u0007",
                "\u202E",
                "\u200B",
                "\u009B",
                "\r",
            ]) {
                expect(out).not.toContain(forbidden);
            }
            expect(out).toContain("]0;owned중간고사 안내");
            expect(out).toContain("Professor[31m A");
            expect(out).toContain("sample[8mfdp.exe");
            // The body keeps its line breaks and tabs
            expect(out).toContain("첫 줄[2J\n\t둘째 줄31m\n셋째 줄");
        });

        it("keeps the values intact, escaped, with --json", async () => {
            getNoticeDetailMock.mockResolvedValue(hostile);

            await run(["notices", "read", "365529", "413476", "--json"]);

            const printed = String(logSpy.mock.calls[0]?.[0]);
            expect(printed).not.toContain(ESC);
            expect(JSON.parse(printed)).toEqual(hostile);
        });
    });
});
