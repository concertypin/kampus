import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from "vitest";
import { LogLevels } from "consola";
import {
    createTaggedLogger,
    getLogger,
    setLogLevel,
    type LogLevel,
} from "@/logger";

/** Log one message per method and return what reached stderr, in order. */
function emitAll(): string[] {
    const log = getLogger();
    log.error("e");
    log.warn("w");
    log.info("i");
    log.debug("d");
    log.trace("t");
    return stderr.mock.calls.map((call) => String(call[0]));
}

let stderr: MockInstance<typeof console.error>;

beforeEach(() => {
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    stderr.mockRestore();
});

describe("log level filtering", () => {
    const cases = [
        ["silent", []],
        ["error", ["error e"]],
        ["warn", ["error e", "warn w"]],
        ["info", ["error e", "warn w", "info i"]],
        ["debug", ["error e", "warn w", "info i", "debug d"]],
        ["trace", ["error e", "warn w", "info i", "debug d", "trace t"]],
    ] satisfies [LogLevel, string[]][];

    it.each(cases)("%s prints the expected messages", (level, lines) => {
        setLogLevel(level);
        expect(emitAll()).toEqual(lines);
    });
});

describe("default level", () => {
    it("shows warnings but hides info on a fresh module instance", async () => {
        vi.resetModules();
        const fresh = await import("@/logger");
        const log = fresh.getLogger();
        log.warn("careful");
        log.info("chatty");
        expect(stderr.mock.calls.map((c) => String(c[0]))).toEqual([
            "warn careful",
        ]);
    });
});

describe("message formatting", () => {
    beforeEach(() => setLogLevel("info"));

    it("prefixes the tag", () => {
        createTaggedLogger("auth").info("hello");
        expect(stderr).toHaveBeenCalledWith("auth:info hello");
    });

    it("prints strings as-is and formats each argument separately", () => {
        getLogger().info("count:", 3, { a: 1 }, ["x"], null);
        expect(stderr).toHaveBeenCalledWith('info count: 3 {"a":1} ["x"] null');
    });

    it("prints an Error as name: message without a stack below debug", () => {
        getLogger().error("failed:", new TypeError("boom"));
        const line = String(stderr.mock.calls[0]?.[0]);
        expect(line).toBe("error failed: TypeError: boom");
    });

    it("includes the stack for an Error at debug level", () => {
        setLogLevel("debug");
        const err = new Error("boom");
        err.stack = "Error: boom\n    at somewhere (file.ts:1:1)";
        getLogger().error(err);
        expect(stderr).toHaveBeenCalledWith(`error ${err.stack}`);
    });

    it("decides stack output from the level of the logger that emitted", () => {
        setLogLevel("warn");
        const err = new Error("boom");
        err.stack = "Error: boom\n    at somewhere (file.ts:1:1)";
        const tagged = createTaggedLogger("fetch");
        tagged.level = LogLevels.debug;
        tagged.error(err);
        expect(stderr).toHaveBeenLastCalledWith(`fetch:error ${err.stack}`);

        tagged.level = LogLevels.warn;
        setLogLevel("debug");
        tagged.error(err);
        expect(stderr).toHaveBeenLastCalledWith("fetch:error Error: boom");
    });

    it("replaces control and bidi characters but keeps newlines and tabs", () => {
        getLogger().info("a\u001b[2Jb\u202ec\u0000d\ne\tf");
        expect(stderr).toHaveBeenCalledWith(
            "info a\ufffd[2Jb\ufffdc\ufffdd\ne\tf"
        );
    });

    it("prints the cause chain of an Error", () => {
        const err = new Error("outer", {
            cause: new TypeError("inner", { cause: "root" }),
        });
        getLogger().error(err);
        expect(stderr).toHaveBeenCalledWith(
            "error Error: outer\nCaused by: TypeError: inner\nCaused by: root"
        );
    });

    it("stops at a cause cycle", () => {
        const err = new Error("loop");
        err.cause = err;
        getLogger().error(err);
        expect(stderr).toHaveBeenCalledWith("error Error: loop");
    });

    it("prints an Error nested in an object as name: message", () => {
        getLogger().info("x", { error: new RangeError("bad") });
        expect(stderr).toHaveBeenCalledWith(
            'info x {"error":"RangeError: bad"}'
        );
    });

    it("prints a value it cannot format at all as [unprintable]", () => {
        const { proxy, revoke } = Proxy.revocable({}, {});
        revoke();
        expect(() => getLogger().info("x", proxy)).not.toThrow();
        expect(stderr).toHaveBeenCalledWith("info x [unprintable]");
    });

    it("falls back to String() for circular objects", () => {
        const circular: Record<string, unknown> = {};
        circular["self"] = circular;
        getLogger().info(circular);
        expect(stderr).toHaveBeenCalledWith("info [object Object]");
    });

    it("falls back to String() for values JSON cannot represent", () => {
        getLogger().info(undefined, 10n);
        expect(stderr).toHaveBeenCalledWith("info undefined 10");
    });

    it("does not throw for a circular object without a prototype", () => {
        const circular: Record<string, unknown> = {};
        Object.setPrototypeOf(circular, null);
        circular["self"] = circular;
        expect(() => getLogger().info(circular)).not.toThrow();
        expect(stderr).toHaveBeenCalledWith("info [object Object]");
    });

    it("does not throw when toString throws", () => {
        const hostile = {
            toJSON: () => undefined,
            toString: () => {
                throw new Error("boom");
            },
        };
        expect(() => getLogger().info(hostile)).not.toThrow();
        expect(stderr).toHaveBeenCalledWith("info [object Object]");
    });
});
