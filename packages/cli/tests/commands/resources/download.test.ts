import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { downloadCommand } from "@/commands/resources/download";
import { resourcesCommand } from "@/commands/resources/index";
import type {
    ResourceDetail,
    Crawler,
    LogLevel,
} from "@concertypin/ecampus-crawler";
import { fragile } from "../../utils";

vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel | undefined>(() => undefined),
}));

// Mock node:stream/promises pipeline to simulate successful download
vi.mock("node:stream/promises", () => ({
    pipeline: vi.fn<() => Promise<void>>(() => Promise.resolve()),
}));

// Mock node:stream Readable.fromWeb
vi.mock("node:stream", () => ({
    Readable: {
        fromWeb: vi.fn<() => object>(() => ({
            on: vi.fn<() => object>(),
            pipe: vi.fn<() => object>(),
        })),
    },
}));

vi.mock("node:fs", () => ({
    createWriteStream: vi.fn<() => object>(() => ({
        write: vi.fn<() => boolean>(() => true),
        end: vi.fn<() => void>(),
        on: vi.fn<(event: string, cb: (...args: unknown[]) => void) => object>(
            (event: string, cb: (...args: unknown[]) => void) => {
                if (event === "finish") queueMicrotask(() => cb());
                return {
                    on: vi.fn<() => object>(),
                    once: vi.fn<() => object>(),
                };
            }
        ),
        once: vi.fn<
            (event: string, cb: (...args: unknown[]) => void) => object
        >((event: string, cb: () => void) => {
            if (event === "drain") queueMicrotask(cb);
            return { on: vi.fn<() => object>(), once: vi.fn<() => object>() };
        }),
    })),
}));

vi.mock("node:fs/promises", () => ({
    mkdir: vi.fn<() => Promise<void>>(),
    rm: vi.fn<() => Promise<void>>(),
    stat: vi.fn<() => Promise<{ size: number }>>(() =>
        Promise.resolve({ size: 12468 })
    ),
}));

const getResourceDetailMock =
    vi.fn<(cmid: string) => Promise<ResourceDetail>>();
const getSessionMock = vi.fn<() => Promise<string | undefined>>();

const mockCrawler = fragile<Crawler>({
    getResourceDetail: getResourceDetailMock,
    getSession: getSessionMock,
});

const sampleResource: ResourceDetail = {
    id: "123456",
    name: "1주차 강의자료",
    description: "강의 슬라이드 및 참고자료",
    files: [
        {
            name: "lecture1.pdf",
            url: "https://ecampus.kangnam.ac.kr/pluginfile.php?file=/lecture1.pdf",
        },
    ],
};

describe("resources download command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.exitCode = 0;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.exitCode = 0;
    });

    it("should have correct name and description", () => {
        expect(downloadCommand.name()).toBe("download");
        expect(downloadCommand.description()).toContain("강의자료");
    });

    it("should require resourceId argument", () => {
        const args = downloadCommand.registeredArguments;
        expect(args.length).toBe(1);
        expect(args[0]?.required).toBe(true);
        expect(args[0]?.name()).toBe("resourceId");
    });

    it("should have --output option", () => {
        const opts = downloadCommand.options;
        expect(opts.length).toBeGreaterThanOrEqual(1);
        const outputOpt = opts.find((o) => o.name() === "output");
        expect(outputOpt).toBeDefined();
        expect(outputOpt?.short).toBe("-o");
    });

    it("should exit when no session", async () => {
        getSessionMock.mockResolvedValue(undefined);

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "download", "123456"], {
            from: "user",
        });

        expect(getResourceDetailMock).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(1);

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should exit when session has no MoodleSession cookie", async () => {
        getSessionMock.mockResolvedValue("SomeOtherCookie=value; path=/");

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "download", "123456"], {
            from: "user",
        });

        expect(getResourceDetailMock).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(1);

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should handle fetch error", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=test");
        getResourceDetailMock.mockRejectedValue(new Error("Fetch failed"));

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "download", "123456"], {
            from: "user",
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("Fetch failed")
        );
        expect(process.exitCode).toBe(1);

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should handle no files", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=test");
        getResourceDetailMock.mockResolvedValue({
            ...sampleResource,
            files: [],
        });

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "download", "123456"], {
            from: "user",
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("첨부파일이 없습니다")
        );

        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
    });

    it("should download file successfully (happy path)", async () => {
        getSessionMock.mockResolvedValue("MoodleSession=abc123; path=/");
        getResourceDetailMock.mockResolvedValue(sampleResource);

        // Mock global fetch for the download - response URL must match allowed domain
        const mockResponse = {
            ok: true,
            status: 200,
            statusText: "OK",
            url: "https://ecampus.kangnam.ac.kr/pluginfile.php?file=/lecture1.pdf",
            body: {}, // Body is mocked via Readable.fromWeb
        };
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(mockResponse))
        );

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleLogSpy = vi
            .spyOn(console, "log")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "download", "123456"], {
            from: "user",
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("결과")
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining("1개 성공")
        );

        consoleLogSpy.mockRestore();
        stdoutSpy.mockRestore();
        vi.unstubAllGlobals();
    });
});
