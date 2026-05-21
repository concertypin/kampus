import type { SessionStorage } from "./storage";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * File-based implementation of SessionStorage.
 */
export class FileStorage implements SessionStorage {
    constructor(private filePath: string) {}

    private async readData(): Promise<Record<string, string>> {
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
        try {
            await fs.unlink(this.filePath);
        } catch (err: unknown) {
            if ((err as { code?: string }).code !== "ENOENT") {
                throw err;
            }
        }
    }
}
