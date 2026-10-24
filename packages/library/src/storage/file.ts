import type { SessionStorage } from "./storage";
import { isNode } from "../env";

/**
 * File-based implementation of SessionStorage.
 * Uses Node.js fs/path APIs. Throws if used in non-Node environments.
 *
 * **Note on concurrency**: The read-modify-write pattern in set() and delete()
 * is not atomic. Concurrent writes from multiple processes or rapid sequential
 * calls may cause lost updates. For CLI usage, this is acceptable — the tool
 * does not access the session file from multiple processes simultaneously.
 */
export class FileStorage implements SessionStorage {
    private filePath: string;

    constructor(filePath: string) {
        if (!isNode) {
            throw new Error(
                "FileStorage is only supported in Node.js environments. Use MemoryStorage in Deno."
            );
        }
        this.filePath = filePath;
    }

    private async readData(): Promise<Record<string, string>> {
        const fs = await import("node:fs/promises");
        try {
            const content = await fs.readFile(this.filePath, "utf-8");
            return JSON.parse(content) as Record<string, string>;
        } catch (err: unknown) {
            if ((err as { code?: string }).code === "ENOENT") {
                return {};
            }
            throw err;
        }
    }

    private async writeData(data: Record<string, string>): Promise<void> {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        await fs.mkdir(path.dirname(this.filePath), {
            recursive: true,
            mode: 0o700,
        });
        // Write a temporary file next to the target and rename it over the
        // target, so a crash mid-write leaves the old file intact instead of
        // a truncated one (which would lose the stored credentials). The
        // name is fixed, so a temporary file left by a crash is replaced by
        // the next write and removed by delete() and clear(). It is removed
        // and then created exclusively, so the new file gets mode 0600 from
        // the start and a link planted at that path is not followed.
        const tmpPath = this.tmpPath();
        try {
            await this.removeTmp();
            await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), {
                encoding: "utf-8",
                mode: 0o600,
                flag: "wx",
            });
            await fs.chmod(tmpPath, 0o600);
            await fs.rename(tmpPath, this.filePath);
        } catch (err: unknown) {
            await fs.unlink(tmpPath).catch(() => undefined);
            throw err;
        }
    }

    async get(key: string): Promise<string | undefined> {
        const data = await this.readData();
        return data[key];
    }

    async set(key: string, value: string): Promise<void> {
        const data = await this.readData();
        data[key] = value;
        await this.writeData(data);
    }

    async delete(key: string): Promise<void> {
        const data = await this.readData();
        if (key in data) {
            delete data[key];
            await this.writeData(data);
        }
        // A temporary file left by a crashed write can hold the deleted
        // value (logout deletes keys, it does not clear the file).
        await this.removeTmp();
    }

    async clear(): Promise<void> {
        const fs = await import("node:fs/promises");
        try {
            await fs.unlink(this.filePath);
        } catch (err: unknown) {
            if ((err as { code?: string }).code !== "ENOENT") {
                throw err;
            }
        }
        await this.removeTmp();
    }

    /** Removes the staging file, if any. */
    private async removeTmp(): Promise<void> {
        const fs = await import("node:fs/promises");
        try {
            await fs.unlink(this.tmpPath());
        } catch (err: unknown) {
            if ((err as { code?: string }).code !== "ENOENT") {
                throw err;
            }
        }
    }

    /** Where a write is staged before it replaces the file. */
    private tmpPath(): string {
        return `${this.filePath}.tmp`;
    }
}
