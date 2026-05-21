import { describe, expect, it, beforeEach } from "vitest";
import { MemoryStorage } from "@/storage/memory";

describe("MemoryStorage", () => {
    let storage: MemoryStorage;

    beforeEach(() => {
        storage = new MemoryStorage();
    });

    it("should return undefined for non-existent key", async () => {
        const result = await storage.get("nonexistent");
        expect(result).toBeUndefined();
    });

    it("should set and get a value", async () => {
        await storage.set("key", "value");
        const result = await storage.get("key");
        expect(result).toBe("value");
    });

    it("should overwrite existing value", async () => {
        await storage.set("key", "value1");
        await storage.set("key", "value2");
        const result = await storage.get("key");
        expect(result).toBe("value2");
    });

    it("should delete a value", async () => {
        await storage.set("key", "value");
        await storage.delete("key");
        const result = await storage.get("key");
        expect(result).toBeUndefined();
    });

    it("should clear all values", async () => {
        await storage.set("key1", "value1");
        await storage.set("key2", "value2");
        await storage.clear();
        expect(await storage.get("key1")).toBeUndefined();
        expect(await storage.get("key2")).toBeUndefined();
    });
});
