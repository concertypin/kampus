import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { logoutCommand } from "@/commands/auth/logout";
import { authCommand } from "@/commands/auth/index";
import type { Crawler, LogLevel } from "@concertypin/ecampus-crawler";
import { fragile } from "../../utils";

// Mock the crawler module
vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

// Mock the getLogLevel function
vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel | undefined>(() => undefined),
}));

const clearSessionMock = vi.fn<() => Promise<void>>();
const clearCredentialsMock = vi.fn<() => Promise<void>>();

const mockCrawler = fragile<Crawler>({
    clearSession: clearSessionMock,
    clearCredentials: clearCredentialsMock,
});

describe("auth logout command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should have correct name and description", () => {
        expect(logoutCommand.name()).toBe("logout");
        expect(logoutCommand.description()).toContain("세션");
    });

    it("should have no arguments", () => {
        const args = logoutCommand.registeredArguments;
        expect(args.length).toBe(0);
    });

    it("should call clearSession with --force", async () => {
        clearSessionMock.mockResolvedValue(undefined);

        const program = new Command();
        program.addCommand(authCommand);
        program.exitOverride();

        const consoleSpy = vi.spyOn(console, "log");

        await program.parseAsync(["auth", "logout", "--force"], {
            from: "user",
        });

        expect(clearSessionMock).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("세션")
        );

        consoleSpy.mockRestore();
    });

    it("should cancel without --force when not TTY", async () => {
        const program = new Command();
        program.addCommand(authCommand);
        program.exitOverride();

        const consoleSpy = vi.spyOn(console, "log");

        await program.parseAsync(["auth", "logout"], { from: "user" });

        expect(clearSessionMock).not.toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("취소")
        );

        consoleSpy.mockRestore();
    });

    it("should handle errors", async () => {
        clearSessionMock.mockRejectedValue(new Error("Test error"));

        const program = new Command();
        program.addCommand(authCommand);
        program.exitOverride();

        const consoleErrorSpy = vi.spyOn(console, "error");

        try {
            await program.parseAsync(["auth", "logout", "--force"], {
                from: "user",
            });
        } catch {
            // Expected
        }

        expect(consoleErrorSpy).toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
    });
});
