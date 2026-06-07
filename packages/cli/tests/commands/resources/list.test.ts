import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { listCommand } from "@/commands/resources/list";
import { resourcesCommand } from "@/commands/resources/index";
import type {
    ResourceItem,
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

const getResourcesMock = vi.fn<(courseId: string) => Promise<ResourceItem[]>>();

const mockCrawler = fragile<Crawler>({
    getResources: getResourcesMock,
});

describe("resources list command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.exitCode = 0;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.exitCode = 0;
    });

    it("should have correct name and description", () => {
        expect(listCommand.name()).toBe("list");
        expect(listCommand.description()).toContain("강의자료");
    });

    it("should require courseId argument", () => {
        const args = listCommand.registeredArguments;
        expect(args.length).toBe(1);
        expect(args[0]?.required).toBe(true);
        expect(args[0]?.name()).toBe("courseId");
    });

    it("should call getResources with courseId", async () => {
        getResourcesMock.mockResolvedValue([]);

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "list", "50541"], {
            from: "user",
        });

        expect(getResourcesMock).toHaveBeenCalledWith("50541");

        stdoutSpy.mockRestore();
    });

    it("should handle errors", async () => {
        getResourcesMock.mockRejectedValue(new Error("Network error"));

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "list", "50541"], {
            from: "user",
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("Network error")
        );
        expect(process.exitCode).toBe(1);

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
        process.exitCode = 0;
    });

    it("should handle empty resources list", async () => {
        getResourcesMock.mockResolvedValue([]);

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "list", "50541"], {
            from: "user",
        });

        expect(getResourcesMock).toHaveBeenCalledWith("50541");

        stdoutSpy.mockRestore();
    });

    it("should handle non-Error rejection", async () => {
        getResourcesMock.mockRejectedValue("String error");

        const program = new Command();
        program.addCommand(resourcesCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["resources", "list", "50541"], {
            from: "user",
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("String error")
        );
        expect(process.exitCode).toBe(1);

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });
});
