import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { listCommand } from "@/commands/vod/list";
import { vodCommand } from "@/commands/vod/index";
import type { VodItem, Crawler, LogLevel } from "@concertypin/ecampus-crawler";
import { fragile } from "../../utils";

vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel | undefined>(() => undefined),
}));

const getVodsMock = vi.fn<(courseId: string) => Promise<VodItem[]>>();

const mockCrawler = fragile<Crawler>({
    getVods: getVodsMock,
});

describe("vod list command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should have correct name and description", () => {
        expect(listCommand.name()).toBe("list");
        expect(listCommand.description()).toContain("VOD");
    });

    it("should require courseId argument", () => {
        const args = listCommand.registeredArguments;
        expect(args.length).toBe(1);
        expect(args[0]?.required).toBe(true);
        expect(args[0]?.name()).toBe("courseId");
    });

    it("should call getVods with courseId", async () => {
        getVodsMock.mockResolvedValue([
            {
                id: "698813",
                week: 2,
                weekTitle: "2주차",
                name: "2주차 강의1",
                duration: "26:19",
                period: "2026-09-14 00:00:00 ~ 2026-09-21 23:59:59",
                latePeriod: "2026-09-28 23:59:59",
                status: "O",
                watchedTime: "26:20 View: 3 time(s)",
                requiredTime: "23:00",
                url: "https://ecampus.kangnam.ac.kr/mod/vod/view.php?id=698813",
            },
        ]);

        const program = new Command();
        program.addCommand(vodCommand);
        program.exitOverride();

        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["vod", "list", "52328"], {
            from: "user",
        });

        expect(getVodsMock).toHaveBeenCalledWith("52328");

        stdoutSpy.mockRestore();
    });

    it("should handle empty VOD list", async () => {
        getVodsMock.mockResolvedValue([]);

        const program = new Command();
        program.addCommand(vodCommand);
        program.exitOverride();

        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["vod", "list", "52328"], {
            from: "user",
        });

        expect(getVodsMock).toHaveBeenCalledWith("52328");
        stdoutSpy.mockRestore();
    });

    it("should handle errors gracefully", async () => {
        getVodsMock.mockRejectedValue(new Error("Network error"));

        const program = new Command();
        program.addCommand(vodCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        try {
            await program.parseAsync(["vod", "list", "52328"], {
                from: "user",
            });
        } catch {
            // Expected
        }

        expect(consoleErrorSpy).toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });
});
