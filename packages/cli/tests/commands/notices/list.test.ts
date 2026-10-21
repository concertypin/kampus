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
import { listCommand } from "@/commands/notices/list";
import { noticesCommand } from "@/commands/notices/index";
import type {
    Crawler,
    LogLevel,
    NoticeItem,
    NoticeList,
    NoticeListOptions,
} from "@concertypin/ecampus-crawler";
import { fragile } from "../../utils";

vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel | undefined>(() => undefined),
}));

const getNoticesMock =
    vi.fn<
        (courseId: string, options?: NoticeListOptions) => Promise<NoticeList>
    >();

const mockCrawler = fragile<Crawler>({
    getNotices: getNoticesMock,
});

const notice: NoticeItem = {
    id: "413476",
    boardId: "442287",
    number: "",
    title: "[공지] 중간고사 안내",
    author: "Professor A",
    date: "2026-10-12",
    views: 50,
    isPinned: true,
    isNew: false,
    hasAttachment: true,
    isSecret: false,
    url: "https://ecampus.kangnam.ac.kr/mod/ubboard/article.php?id=442287&bwid=413476",
};

function listOf(notices: NoticeItem[]): NoticeList {
    return {
        courseId: "365529",
        board: {
            id: "442287",
            name: "공지사항",
            url: "https://ecampus.kangnam.ac.kr/mod/ubboard/view.php?id=442287",
        },
        notices,
        totalCount: notices.length,
        page: 1,
        totalPages: 1,
    };
}

const noBoard: NoticeList = {
    courseId: "377555",
    board: null,
    notices: [],
    totalCount: 0,
    page: 1,
    totalPages: 1,
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

describe("notices list command", () => {
    let logSpy: MockInstance<typeof console.log>;
    let errorSpy: MockInstance<typeof console.error>;

    beforeEach(() => {
        vi.clearAllMocks();
        process.exitCode = undefined;
        // Commander keeps parsed option values on the shared command
        // instances, so reset them between tests.
        for (const cmd of [noticesCommand, listCommand]) {
            for (const key of ["page", "all", "json"]) {
                cmd.setOptionValue(key, undefined);
            }
        }
        logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.exitCode = undefined;
    });

    it("should have correct name and description", () => {
        expect(listCommand.name()).toBe("list");
        expect(listCommand.description()).toContain("공지사항");
    });

    it("should require courseId argument", () => {
        const args = listCommand.registeredArguments;
        expect(args.length).toBe(1);
        expect(args[0]?.required).toBe(true);
        expect(args[0]?.name()).toBe("courseId");
    });

    it("should request page 1 by default", async () => {
        getNoticesMock.mockResolvedValue(listOf([]));

        await run(["notices", "list", "365529"]);

        expect(getNoticesMock).toHaveBeenCalledWith("365529", { page: 1 });
    });

    it("should list notices with the bare `notices <courseId>` form", async () => {
        getNoticesMock.mockResolvedValue(listOf([notice]));

        await run(["notices", "365529"]);

        expect(getNoticesMock).toHaveBeenCalledWith("365529", { page: 1 });
        const out = loggedText(logSpy);
        expect(out).toContain("[공지] 중간고사 안내");
        expect(out).toContain("413476");
        expect(out).toContain("Professor A");
        expect(out).toContain("2026-10-12");
        expect(out).toContain(notice.url);
        expect(out).toContain("[고정]");
        expect(out).toContain("[첨부]");
    });

    it("should pass --page through", async () => {
        getNoticesMock.mockResolvedValue(listOf([]));

        await run(["notices", "list", "365529", "--page", "3"]);

        expect(getNoticesMock).toHaveBeenCalledWith("365529", { page: 3 });
    });

    it("should request every page with --all", async () => {
        getNoticesMock.mockResolvedValue(listOf([]));

        await run(["notices", "365529", "--all"]);

        expect(getNoticesMock).toHaveBeenCalledWith("365529", { all: true });
    });

    it("should print only parseable JSON with --json", async () => {
        const result = listOf([notice]);
        getNoticesMock.mockResolvedValue(result);

        await run(["notices", "list", "365529", "--json"]);

        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual(result);
    });

    it("should accept --json on the bare form", async () => {
        getNoticesMock.mockResolvedValue(noBoard);

        await run(["notices", "377555", "--json"]);

        expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual(noBoard);
        expect(process.exitCode).toBeUndefined();
    });

    it("should report a course without a notice board without failing", async () => {
        getNoticesMock.mockResolvedValue(noBoard);

        await run(["notices", "list", "377555"]);

        expect(loggedText(logSpy)).toContain("공지사항 게시판이 없습니다");
        expect(process.exitCode).toBeUndefined();
    });

    it("should report an empty board", async () => {
        getNoticesMock.mockResolvedValue(listOf([]));

        await run(["notices", "list", "365529"]);

        expect(loggedText(logSpy)).toContain("등록된 공지사항이 없습니다");
    });

    it("should set a failing exit code on errors", async () => {
        getNoticesMock.mockRejectedValue(new Error("Network error"));

        await run(["notices", "list", "365529"]);

        expect(loggedText(errorSpy)).toContain("Network error");
        expect(process.exitCode).toBe(1);
    });

    describe("server-provided text on a terminal", () => {
        const ESC = "\u001b";
        const hostile: NoticeItem = {
            ...notice,
            title: `${ESC}[2J${ESC}]0;owned\u0007중간고사\u202E 안내\u200B`,
            author: `Professor${ESC}[31m A\u009B0m`,
            date: "2026-10-12\r\u001b[1A",
        };

        it("prints no control, escape or bidi characters in text mode", async () => {
            getNoticesMock.mockResolvedValue({
                ...listOf([hostile]),
                board: {
                    id: "442287",
                    name: `공지${ESC}[5m사항`,
                    url: "https://ecampus.kangnam.ac.kr/mod/ubboard/view.php?id=442287",
                },
            });

            await run(["notices", "list", "365529"]);

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
            // The visible text is all still there
            expect(out).toContain("[2J]0;owned중간고사 안내");
            expect(out).toContain("Professor[31m A0m");
            expect(out).toContain("공지[5m사항");
        });

        it("keeps the values intact, escaped, with --json", async () => {
            getNoticesMock.mockResolvedValue(listOf([hostile]));

            await run(["notices", "list", "365529", "--json"]);

            const printed = String(logSpy.mock.calls[0]?.[0]);
            // Nothing raw reaches the terminal: JSON escapes control chars
            expect(printed).not.toContain(ESC);
            expect(printed).not.toContain("\u0007");
            expect(printed).toContain("\\u001b[2J");
            expect(JSON.parse(printed)).toEqual(listOf([hostile]));
        });
    });
});
