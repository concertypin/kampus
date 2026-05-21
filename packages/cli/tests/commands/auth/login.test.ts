import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { loginCommand } from "@/commands/auth/login";
import { authCommand } from "@/commands/auth/index";
import type { Crawler, LogLevel } from "@concertypin/ecampus-crawler";
import type { createCrawler } from "@/crawler";
import { fragile } from "../../utils";

// Mock the crawler module
vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<typeof createCrawler>(() => mockCrawler),
}));

// Mock the getLogLevel function
vi.mock("@/index", () => ({
    getLogLevel: vi.fn<() => LogLevel | undefined>(() => undefined),
}));

const checkSessionMock = vi.fn<() => Promise<boolean>>();
const loginMock =
    vi.fn<(username: string, password: string) => Promise<void>>();

const mockCrawler = fragile<Crawler>({
    checkSession: checkSessionMock,
    login: loginMock,
});

describe("auth login command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should have correct name and description", () => {
        expect(loginCommand.name()).toBe("login");
        expect(loginCommand.description()).toContain("로그인");
    });

    it("should have optional id argument", () => {
        const args = loginCommand.registeredArguments;
        expect(args.length).toBe(1);
        expect(args[0]?.required).toBe(false);
    });

    it("should have --force option", () => {
        const opts = loginCommand.options;
        const forceOpt = opts.find((o) => o.long === "--force");
        expect(forceOpt).toBeDefined();
    });

    it("should reject login when valid session exists without --force", async () => {
        checkSessionMock.mockResolvedValue(true);

        const program = new Command();
        program.addCommand(authCommand);
        program.exitOverride();

        const consoleErrorSpy = vi.spyOn(console, "error");

        // Simulate stdin password input
        const stdinChunks = ["testpassword"];
        let chunkIndex = 0;
        vi.spyOn(process.stdin, "on").mockImplementation((event, callback) => {
            if (event === "data" && chunkIndex < stdinChunks.length) {
                callback(stdinChunks[chunkIndex++]);
            }
            if (event === "end") {
                callback();
            }
            return process.stdin;
        });
        vi.spyOn(process.stdin, "setEncoding").mockImplementation(
            () => process.stdin
        );
        Object.defineProperty(process.stdin, "isTTY", {
            value: false,
            configurable: true,
        });

        try {
            await program.parseAsync(["auth", "login", "testuser"], {
                from: "user",
            });
        } catch {
            // Expected to exit
        }

        expect(checkSessionMock).toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining("세션")
        );

        consoleErrorSpy.mockRestore();
    });
});
