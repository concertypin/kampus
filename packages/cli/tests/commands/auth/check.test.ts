import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { checkCommand } from "@/commands/auth/check";
import { authCommand } from "@/commands/auth/index";
import type { Crawler, LogLevel } from "@concertypin/ecampus-crawler";
import { fragile } from "../../utils";

// Mock the crawler module
vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

// Mock the getLogLevel function
vi.mock("@/index", () => ({
    getLogLevel: vi.fn<() => LogLevel | undefined>(() => undefined),
}));

const checkSessionMock = vi.fn<() => Promise<boolean>>();

const mockCrawler = fragile<Crawler>({
    checkSession: checkSessionMock,
});

describe("auth check command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should have correct name and description", () => {
        expect(checkCommand.name()).toBe("check");
        expect(checkCommand.description()).toContain("세션");
    });

    it("should have no arguments", () => {
        const args = checkCommand.registeredArguments;
        expect(args.length).toBe(0);
    });

    it("should report valid session", async () => {
        checkSessionMock.mockResolvedValue(true);

        const program = new Command();
        program.addCommand(authCommand);
        program.exitOverride();

        const consoleSpy = vi.spyOn(console, "log");

        await program.parseAsync(["auth", "check"], { from: "user" });

        expect(checkSessionMock).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
    });

    it("should report invalid session", async () => {
        checkSessionMock.mockResolvedValue(false);

        const program = new Command();
        program.addCommand(authCommand);
        program.exitOverride();

        const consoleErrorSpy = vi.spyOn(console, "error");

        try {
            await program.parseAsync(["auth", "check"], { from: "user" });
        } catch {
            // Expected exit code 1
        }

        expect(checkSessionMock).toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
    });
});
