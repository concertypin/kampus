import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { downloadCommand } from "@/commands/syllabus/download";
import { syllabusCommand } from "@/commands/syllabus/index";
import type { Crawler, LogLevel } from "@concertypin/ecampus-crawler";
import { fragile } from "../../utils";

vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel | undefined>(() => undefined),
}));

vi.mock("node:fs/promises", () => ({
    mkdir: vi.fn<() => Promise<void>>(),
    stat: vi.fn<() => Promise<{ size: number }>>(() =>
        Promise.resolve({ size: 45678 })
    ),
}));

const getSessionMock = vi.fn<() => Promise<string | undefined>>();
const downloadSyllabusPdfMock =
    vi.fn<(courseId: string, outputPath: string) => Promise<string>>();

const mockCrawler = fragile<Crawler>({
    getSession: getSessionMock,
    downloadSyllabusPdf: downloadSyllabusPdfMock,
});

describe("syllabus download command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.exitCode = undefined;
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.exitCode = undefined;
    });

    it("should fail if not logged in", async () => {
        getSessionMock.mockResolvedValue(undefined);

        const cmd = new Command();
        cmd.addCommand(downloadCommand);
        await cmd.parseAsync(["node", "test", "download", "53472"]);

        expect(process.exitCode).toBe(1);
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining("로그인이 필요합니다")
        );
        expect(downloadSyllabusPdfMock).not.toHaveBeenCalled();
    });

    it("should download syllabus PDF with default path", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc1234");
        downloadSyllabusPdfMock.mockResolvedValue(
            "./downloads/53472_강의계획서.pdf"
        );

        const cmd = new Command();
        cmd.addCommand(downloadCommand);
        await cmd.parseAsync(["node", "test", "download", "53472"]);

        expect(process.exitCode).toBeUndefined();
        expect(downloadSyllabusPdfMock).toHaveBeenCalledWith(
            "53472",
            expect.stringContaining("53472_강의계획서.pdf")
        );
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining("강의계획서 다운로드 완료")
        );
    });

    it("should download syllabus PDF with custom output path", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc1234");
        downloadSyllabusPdfMock.mockResolvedValue("./custom/my_plan.pdf");

        const cmd = new Command();
        cmd.addCommand(downloadCommand);
        await cmd.parseAsync([
            "node",
            "test",
            "download",
            "53472",
            "-o",
            "./custom/my_plan.pdf",
        ]);

        expect(process.exitCode).toBeUndefined();
        expect(downloadSyllabusPdfMock).toHaveBeenCalledWith(
            "53472",
            "./custom/my_plan.pdf"
        );
    });

    it("should handle download errors gracefully", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc1234");
        downloadSyllabusPdfMock.mockRejectedValue(
            new Error("강의계획서 링크를 찾을 수 없습니다.")
        );

        const cmd = new Command();
        cmd.addCommand(downloadCommand);
        await cmd.parseAsync(["node", "test", "download", "99999"]);

        expect(process.exitCode).toBe(1);
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining("강의계획서 링크를 찾을 수 없습니다")
        );
    });

    it("should execute download when syllabus root command is invoked with courseId", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc1234");
        downloadSyllabusPdfMock.mockResolvedValue(
            "./downloads/53472_강의계획서.pdf"
        );

        const cmd = new Command();
        cmd.addCommand(syllabusCommand);
        await cmd.parseAsync(["node", "test", "syllabus", "53472"]);

        expect(process.exitCode).toBeUndefined();
        expect(downloadSyllabusPdfMock).toHaveBeenCalledWith(
            "53472",
            expect.stringContaining("53472_강의계획서.pdf")
        );
    });
});
