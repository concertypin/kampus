import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { logoutCommand } from "@/commands/auth/logout";
import { authCommand } from "@/commands/auth/index";
import type { Crawler, LogLevel } from "@concertypin/ecampus-crawler";
import { KeychainDeleteError } from "@/credential-storage";
import { captureOutput, fragile } from "../../utils";

// Mock the crawler module
vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

// Mock the getLogLevel function
vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel>(() => "warn"),
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

    it("should remove stored credentials and say the keychain entry goes too", async () => {
        clearSessionMock.mockResolvedValue(undefined);
        clearCredentialsMock.mockResolvedValue(undefined);

        const program = new Command();
        program.addCommand(authCommand);
        program.exitOverride();

        const consoleSpy = vi.spyOn(console, "log");
        await program.parseAsync(["auth", "logout", "--force"], {
            from: "user",
        });

        expect(clearCredentialsMock).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("자격 증명 관리자")
        );
    });

    it("should report a keychain removal failure and exit non-zero", async () => {
        clearSessionMock.mockResolvedValue(undefined);
        clearCredentialsMock.mockRejectedValue(new KeychainDeleteError());
        const output = captureOutput();
        const previousExitCode = process.exitCode;

        const program = new Command();
        program.addCommand(authCommand);
        program.exitOverride();
        await program.parseAsync(["auth", "logout", "--force"], {
            from: "user",
        });
        const exitCode = process.exitCode;
        process.exitCode = previousExitCode;

        expect(exitCode).toBe(1);
        expect(output.text()).toContain("키체인");
        expect(output.text()).toContain("삭제하지 못했습니다");
        expect(output.text()).not.toContain("삭제되었습니다");
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
