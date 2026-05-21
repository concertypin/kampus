import type { SessionStorage } from "./storage";

/**
 * In-memory implementation of SessionStorage.
 */
export class MemoryStorage implements SessionStorage {
    private data = new Map<string, string>();

    async get(key: string): Promise<string | undefined> {
        await Promise.resolve();
        return this.data.get(key);
    }

    async set(key: string, value: string): Promise<void> {
        await Promise.resolve();
        this.data.set(key, value);
    }

    async delete(key: string): Promise<void> {
        await Promise.resolve();
        this.data.delete(key);
    }

    async clear(): Promise<void> {
        await Promise.resolve();
        this.data.clear();
    }
}
