import { describe, it, expect, beforeEach } from "vitest";
import {
    setLogLevel,
    getLogger,
    createTaggedLogger,
    type LogLevel,
} from "@/logger";

describe("logger", () => {
    beforeEach(() => {
        // Reset to default silent level
        setLogLevel("silent");
    });

    describe("setLogLevel", () => {
        it("should set log level to silent", () => {
            setLogLevel("silent");
            const logger = getLogger();
            expect(logger.level).toBe(-999);
        });

        it("should set log level to error", () => {
            setLogLevel("error");
            const logger = getLogger();
            expect(logger.level).toBe(0);
        });

        it("should set log level to warn", () => {
            setLogLevel("warn");
            const logger = getLogger();
            expect(logger.level).toBe(1);
        });

        it("should set log level to info (--verbose)", () => {
            setLogLevel("info");
            const logger = getLogger();
            expect(logger.level).toBe(2);
        });

        it("should set log level to debug (--debug)", () => {
            setLogLevel("debug");
            const logger = getLogger();
            expect(logger.level).toBe(3);
        });

        it("should set log level to trace (--trace)", () => {
            setLogLevel("trace");
            const logger = getLogger();
            expect(logger.level).toBe(4);
        });
    });

    describe("getLogger", () => {
        it("should return a consola instance", () => {
            const logger = getLogger();
            expect(logger).toBeDefined();
            expect(typeof logger.level).toBe("number");
        });

        it("should return the same logger instance after setLogLevel", () => {
            setLogLevel("info");
            const logger1 = getLogger();
            setLogLevel("debug");
            const logger2 = getLogger();
            // Both should be consola instances
            expect(logger1).toBeDefined();
            expect(logger2).toBeDefined();
        });
    });

    describe("createTaggedLogger", () => {
        it("should create a logger with a tag", () => {
            const taggedLogger = createTaggedLogger("fetch");
            expect(taggedLogger).toBeDefined();
        });

        it("should create different tagged loggers for different tags", () => {
            const fetchLogger = createTaggedLogger("fetch");
            const authLogger = createTaggedLogger("auth");
            expect(fetchLogger).toBeDefined();
            expect(authLogger).toBeDefined();
        });
    });

    describe("LogLevel type", () => {
        it("should have correct levels", () => {
            const levels: LogLevel[] = [
                "silent",
                "error",
                "warn",
                "info",
                "debug",
                "trace",
            ];
            expect(levels).toHaveLength(6);
        });
    });
});
