import type { SessionStorage } from "./storage";
import { isNode } from "../env";

/**
 * File-based implementation of SessionStorage.
 * Uses Node.js fs/path APIs. Throws if used in non-Node environments.
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
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(
            this.filePath,
            JSON.stringify(data, null, 2),
            "utf-8"
        );
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
    }
}
