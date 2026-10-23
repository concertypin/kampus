// Keep it light for test setups,
// Since all tests will slow down if this file is heavy.
import { beforeEach } from "vitest";
import { setLogLevel } from "@/logger";

// The library logs to stderr; keep test output quiet unless a test opts in.
beforeEach(() => {
    setLogLevel("silent");
});
