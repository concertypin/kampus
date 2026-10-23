import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLogLevel, setProgramOptsFn } from "@/log-level";

function withOpts(opts: Record<string, unknown>): void {
    setProgramOptsFn(() => opts);
}

describe("getLogLevel", () => {
    beforeEach(() => {
        withOpts({});
    });

    it("returns warn when no flag is given", () => {
        expect(getLogLevel()).toBe("warn");
    });

    it("returns warn when options are not registered yet", async () => {
        // Fresh module instance: setProgramOptsFn was never called.
        vi.resetModules();
        const fresh = await import("@/log-level");
        expect(fresh.getLogLevel()).toBe("warn");
    });

    it("maps --verbose to info", () => {
        withOpts({ verbose: true });
        expect(getLogLevel()).toBe("info");
    });

    it("maps --debug to debug", () => {
        withOpts({ debug: true });
        expect(getLogLevel()).toBe("debug");
    });

    it("maps --trace to trace", () => {
        withOpts({ trace: true });
        expect(getLogLevel()).toBe("trace");
    });

    it("prefers the most verbose flag when several are given", () => {
        withOpts({ verbose: true, debug: true, trace: true });
        expect(getLogLevel()).toBe("trace");
        withOpts({ verbose: true, debug: true });
        expect(getLogLevel()).toBe("debug");
    });
});
