import { describe, expect, it } from "vitest";
import { Crawler, MemoryStorage, FileStorage } from "@/index";

describe("example test", () => {
    it("should export Crawler", () => {
        expect(Crawler).toBeDefined();
    });

    it("should export storage classes", () => {
        expect(MemoryStorage).toBeDefined();
        expect(FileStorage).toBeDefined();
    });
});
