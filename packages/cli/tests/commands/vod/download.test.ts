import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { downloadCommand } from "@/commands/vod/download";
import { vodCommand } from "@/commands/vod/index";
import type {
    VodDetail,
    Crawler,
    LogLevel,
} from "@concertypin/ecampus-crawler";
import { fragile } from "../../utils";
import * as downloadModule from "@/commands/vod/download";
import { EventEmitter } from "node:events";

vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel>(() => "warn"),
}));

const mockSpawnProc = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
});

const mockSpawn = vi.fn<(cmd: string, args: string[]) => typeof mockSpawnProc>(
    (_cmd, _args) => {
        setTimeout(() => {
            mockSpawnProc.emit("close", 0);
        }, 10);
        return mockSpawnProc;
    }
);

const mockSpawnSync = vi.fn<
    (cmd?: string, args?: string[]) => { status: number }
>(() => ({ status: 0 }));

vi.mock("node:child_process", () => ({
    spawn: (cmd: string, args: string[]) => mockSpawn(cmd, args),
    spawnSync: (cmd?: string, args?: string[]) => mockSpawnSync(cmd, args),
}));

const getVodDetailMock = vi.fn<(vodId: string) => Promise<VodDetail>>();

const mockCrawler = fragile<Crawler>({
    getVodDetail: getVodDetailMock,
});

describe("vod download command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSpawnSync.mockReturnValue({ status: 0 });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should have correct name and description", () => {
        expect(downloadCommand.name()).toBe("download");
        expect(downloadCommand.description()).toContain("다운로드");
    });

    it("should require vodId argument", () => {
        const args = downloadCommand.registeredArguments;
        expect(args.length).toBe(1);
        expect(args[0]?.required).toBe(true);
        expect(args[0]?.name()).toBe("vodId");
    });

    it("should have output option", () => {
        const opt = downloadCommand.options.find(
            (o) => o.attributeName() === "output"
        );
        expect(opt).toBeDefined();
    });

    it("should fail if ffmpeg is not available", async () => {
        vi.spyOn(downloadModule, "isFfmpegAvailable").mockReturnValue(false);

        const program = new Command();
        program.addCommand(vodCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        await program.parseAsync(["vod", "download", "350468"], {
            from: "user",
        });

        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(process.exitCode).toBe(1);
        process.exitCode = undefined;
    });

    it("should download vod using ffmpeg with -c:v copy -c:a copy and mkv format", async () => {
        vi.spyOn(downloadModule, "isFfmpegAvailable").mockReturnValue(true);
        getVodDetailMock.mockResolvedValue({
            id: "350468",
            name: "2주차 강의1",
            description: "",
            period: "2026-09-14 ~ 2026-09-21",
            m3u8Url: "https://vod3.kangnam.ac.kr/playlist.m3u8",
        });

        const program = new Command();
        program.addCommand(vodCommand);
        program.exitOverride();

        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);
        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});

        await program.parseAsync(
            ["vod", "download", "350468", "-o", "custom.mkv"],
            { from: "user" }
        );

        expect(mockSpawn).toHaveBeenCalled();
        const callArgs = mockSpawn.mock.calls[0];
        expect(callArgs?.[0]).toBe("ffmpeg");
        const ffmpegArgs = callArgs?.[1] as string[];
        expect(ffmpegArgs).toContain("-c:v");
        expect(ffmpegArgs).toContain("-c:a");
        expect(ffmpegArgs).toContain("copy");
        expect(ffmpegArgs[ffmpegArgs.length - 1]).toContain("custom.mkv");

        stdoutSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });
});
