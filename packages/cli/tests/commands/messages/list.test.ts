import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { listCommand } from "@/commands/messages/list";
import { messagesCommand } from "@/commands/messages/index";
import type {
    Crawler,
    LogLevel,
    MessageItem,
} from "@concertypin/ecampus-crawler";
import { fragile } from "../../utils";

vi.mock("@/crawler", () => ({
    createCrawler: vi.fn<() => Crawler>(() => mockCrawler),
}));

vi.mock("@/log-level", () => ({
    getLogLevel: vi.fn<() => LogLevel | undefined>(() => undefined),
}));

const getMessagesMock = vi.fn<(page: number) => Promise<MessageItem[]>>();

const mockCrawler = fragile<Crawler>({
    getMessages: getMessagesMock,
});

describe("messages list command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should have correct name and description", () => {
        expect(listCommand.name()).toBe("list");
        expect(listCommand.description()).toContain("메시지");
    });

    it("should have --page option", () => {
        const opts = listCommand.options;
        const pageOpt = opts.find((o) => o.long === "--page");
        expect(pageOpt).toBeDefined();
    });

    it("should call getMessages with default page 1", async () => {
        getMessagesMock.mockResolvedValue([]);

        const program = new Command();
        program.addCommand(messagesCommand);
        program.exitOverride();

        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["messages", "list"], { from: "user" });

        expect(getMessagesMock).toHaveBeenCalledWith(1);

        stdoutSpy.mockRestore();
    });

    it("should call getMessages with custom page", async () => {
        getMessagesMock.mockResolvedValue([]);

        const program = new Command();
        program.addCommand(messagesCommand);
        program.exitOverride();

        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        await program.parseAsync(["messages", "list", "--page", "3"], {
            from: "user",
        });

        expect(getMessagesMock).toHaveBeenCalledWith(3);

        stdoutSpy.mockRestore();
    });

    it("should handle errors", async () => {
        getMessagesMock.mockRejectedValue(new Error("Network error"));

        const program = new Command();
        program.addCommand(messagesCommand);
        program.exitOverride();

        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockImplementation(() => true);

        try {
            await program.parseAsync(["messages", "list"], { from: "user" });
        } catch {
            // Expected
        }

        expect(consoleErrorSpy).toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
        stdoutSpy.mockRestore();
    });
});
