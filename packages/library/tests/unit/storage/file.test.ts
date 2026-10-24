import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
    mkdtemp,
    rm,
    access,
    stat,
    readdir,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorage } from "@/storage/file";

/** Makes the final rename fail, as if the process died before it. */
const renameFault = vi.hoisted(() => ({ on: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
    const fs = await importOriginal<typeof import("node:fs/promises")>();
    return {
        ...fs,
        rename: (from: string, to: string) =>
            renameFault.on
                ? Promise.reject(new Error("rename failed"))
                : fs.rename(from, to),
    };
});

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
        renameFault.on = false;
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

    it("keeps the old file intact when a write does not complete", async () => {
        await storage.set("credentials", "old");
        renameFault.on = true;

        await expect(storage.set("credentials", "new")).rejects.toThrow(
            "rename failed"
        );

        renameFault.on = false;
        expect(await new FileStorage(storagePath).get("credentials")).toBe(
            "old"
        );
        // The temporary file is removed again.
        expect(await readdir(tempDir)).toEqual(["session.json"]);
    });

    it("overwrites a temporary file left by a crash, and clear() removes one", async () => {
        const leftover = `${storagePath}.tmp`;
        await writeFile(leftover, JSON.stringify({ credentials: "old" }));

        await storage.set("session", "cookie");
        expect(await readdir(tempDir)).toEqual(["session.json"]);

        await writeFile(leftover, JSON.stringify({ credentials: "old" }));
        await storage.clear();
        expect(await readdir(tempDir)).toEqual([]);
    });

    it("should create nested directories", async () => {
        const nestedPath = join(tempDir, "nested", "dir", "session.json");
        const nestedStorage = new FileStorage(nestedPath);

        await nestedStorage.set("key", "value");
        const result = await nestedStorage.get("key");
        expect(result).toBe("value");
    });

    // POSIX permission bits are not meaningful on Windows.
    it.skipIf(process.platform === "win32")(
        "should create the directory as 0700 and the file as 0600",
        async () => {
            const nestedPath = join(tempDir, "private", "session.json");
            await new FileStorage(nestedPath).set("key", "value");

            const dirMode = (await stat(join(tempDir, "private"))).mode;
            const fileMode = (await stat(nestedPath)).mode;
            expect(dirMode & 0o777).toBe(0o700);
            expect(fileMode & 0o777).toBe(0o600);
        }
    );
});
