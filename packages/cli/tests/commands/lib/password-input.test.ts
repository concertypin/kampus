import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { readPasswordInteractive } from "@/commands/lib/password-input";

/**
 * Creates a mock input stream that emits data events on demand.
 */
function createMockInput() {
    const emitter = new EventEmitter();
    let _rawMode = false;

    return {
        emitter,
        stream: {
            isTTY: true,
            setRawMode(mode: boolean) {
                _rawMode = mode;
            },
            on: (event: string, listener: (...args: unknown[]) => void) =>
                emitter.on(event, listener),
            removeListener: (
                event: string,
                listener: (...args: unknown[]) => void
            ) => emitter.removeListener(event, listener),
            pause: () => {},
            resume: () => {},
        } as unknown as NodeJS.ReadStream & {
            isTTY: boolean;
            setRawMode(mode: boolean): void;
        },
    };
}

/**
 * Creates a mock output stream that captures written data.
 */
function createMockOutput() {
    let output = "";

    const writable = new Writable({
        write(
            chunk: unknown,
            _encoding: BufferEncoding,
            callback: (error?: Error | null) => void
        ) {
            output += String(chunk);
            callback();
        },
    });

    return {
        writable,
        getOutput: () => output,
    };
}

describe("readPasswordInteractive", () => {
    it("should return the password when Enter is pressed", async () => {
        const { emitter, stream } = createMockInput();
        const { writable, getOutput } = createMockOutput();

        const promise = readPasswordInteractive("Password: ", {
            input: stream,
            output: writable,
        });

        // Simulate typing "abc" then Enter
        emitter.emit("data", Buffer.from("a"));
        emitter.emit("data", Buffer.from("b"));
        emitter.emit("data", Buffer.from("c"));
        emitter.emit("data", Buffer.from("\r"));

        const result = await promise;
        expect(result).toBe("abc");
        expect(getOutput()).toContain("Password: ");
        expect(getOutput()).toContain("***");
    });

    it("should echo stars for each character", async () => {
        const { emitter, stream } = createMockInput();
        const { writable, getOutput } = createMockOutput();

        const promise = readPasswordInteractive("> ", {
            input: stream,
            output: writable,
        });

        emitter.emit("data", Buffer.from("s"));
        emitter.emit("data", Buffer.from("e"));
        emitter.emit("data", Buffer.from("c"));
        emitter.emit("data", Buffer.from("\n"));

        await promise;
        expect(getOutput()).toBe("> ***\n");
    });

    it("should handle paste (multiple chars in one buffer)", async () => {
        const { emitter, stream } = createMockInput();
        const { writable, getOutput } = createMockOutput();

        const promise = readPasswordInteractive("", {
            input: stream,
            output: writable,
        });

        // Simulate paste: entire password in one data event
        emitter.emit("data", Buffer.from("MyP@ssw0rd!"));
        emitter.emit("data", Buffer.from("\r"));

        const result = await promise;
        expect(result).toBe("MyP@ssw0rd!");
        // Should show 11 stars
        expect(getOutput()).toContain("***********");
    });

    it("should handle backspace", async () => {
        const { emitter, stream } = createMockInput();
        const { writable, getOutput } = createMockOutput();

        const promise = readPasswordInteractive("", {
            input: stream,
            output: writable,
        });

        emitter.emit("data", Buffer.from("a"));
        emitter.emit("data", Buffer.from("b"));
        emitter.emit("data", Buffer.from("\u007f")); // backspace
        emitter.emit("data", Buffer.from("c"));
        emitter.emit("data", Buffer.from("\r"));

        const result = await promise;
        expect(result).toBe("ac");
        // Stars: * for a, * for b, backspace (no star), * for c
        expect(getOutput()).toContain("**");
    });

    it("should handle Ctrl+C by returning empty string", async () => {
        const { emitter, stream } = createMockInput();
        const { writable } = createMockOutput();

        const promise = readPasswordInteractive("", {
            input: stream,
            output: writable,
        });

        emitter.emit("data", Buffer.from("a"));
        emitter.emit("data", Buffer.from("\u0003")); // Ctrl+C

        const result = await promise;
        expect(result).toBe("");
    });

    it("should return empty string on error", async () => {
        const { emitter, stream } = createMockInput();
        const { writable } = createMockOutput();

        const promise = readPasswordInteractive("", {
            input: stream,
            output: writable,
        });

        emitter.emit("error", new Error("stream error"));

        const result = await promise;
        expect(result).toBe("");
    });
});
