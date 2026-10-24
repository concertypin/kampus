import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { checkCommand } from "@/commands/auth/check";
import { authCommand } from "@/commands/auth/index";
import type { Crawler, LogLevel } from "@concertypin/ecampus-crawler";
import type { CredentialLocation } from "@/credential-storage";
import { captureOutput, fragile } from "../../utils";

// Mock the crawler module
vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
    getCredentialLocation: vi.fn<() => Promise<CredentialLocation>>(() =>
        getCredentialLocationMock()
    ),
}));

// Mock the getLogLevel function
vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel>(() => "warn"),
}));

const checkSessionMock = vi.fn<() => Promise<boolean>>();
const getCredentialLocationMock = vi.fn<() => Promise<CredentialLocation>>();

const mockCrawler = fragile<Crawler>({
    checkSession: checkSessionMock,
});

describe("auth check command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getCredentialLocationMock.mockResolvedValue("none");
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

    it.each([
        ["keychain", "OS 키체인"],
        ["file", "세션 파일"],
        ["none", "저장된 인증 정보 없음"],
    ] as const)(
        "should show where credentials are stored (%s)",
        async (location, label) => {
            checkSessionMock.mockResolvedValue(true);
            getCredentialLocationMock.mockResolvedValue(location);
            const output = captureOutput();

            const program = new Command();
            program.addCommand(authCommand);
            program.exitOverride();
            await program.parseAsync(["auth", "check"], { from: "user" });

            expect(output.text()).toContain("인증 정보 저장 위치:");
            expect(output.text()).toContain(label);
        }
    );

    it("should still show the session result when the location lookup fails", async () => {
        checkSessionMock.mockResolvedValue(true);
        getCredentialLocationMock.mockRejectedValue(new Error("boom"));
        const output = captureOutput();

        const program = new Command();
        program.addCommand(authCommand);
        program.exitOverride();
        await program.parseAsync(["auth", "check"], { from: "user" });

        expect(output.text()).toContain("세션이 유효");
        expect(output.text()).not.toContain("인증 정보 저장 위치");
    });
});
