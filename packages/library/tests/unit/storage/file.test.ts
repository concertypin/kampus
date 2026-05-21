import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorage } from "@/storage/file";

describe("FileStorage", () => {
    let tempDir: string;
    let storagePath: string;
    let storage: FileStorage;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "filestorage-test-"));
        storagePath = join(tempDir, "session.json");
        storage = new FileStorage(storagePath);
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
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

    it("should persist data to file", async () => {
        await storage.set("key", "value");

        // Create new storage instance to read from file
        const newStorage = new FileStorage(storagePath);
        const result = await newStorage.get("key");
        expect(result).toBe("value");
    });

    it("should delete a value", async () => {
        await storage.set("key", "value");
        await storage.delete("key");
        const result = await storage.get("key");
        expect(result).toBeUndefined();
    });

    it("should clear all values and delete file", async () => {
        await storage.set("key1", "value1");
        await storage.set("key2", "value2");
        await storage.clear();

        expect(await storage.get("key1")).toBeUndefined();
        expect(await storage.get("key2")).toBeUndefined();

        // File should be deleted
        await expect(access(storagePath)).rejects.toThrow(Error);
    });

    it("should create nested directories", async () => {
        const nestedPath = join(tempDir, "nested", "dir", "session.json");
        const nestedStorage = new FileStorage(nestedPath);

        await nestedStorage.set("key", "value");
        const result = await nestedStorage.get("key");
        expect(result).toBe("value");
    });
});
