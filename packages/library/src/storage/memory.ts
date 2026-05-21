import type { SessionStorage } from "./storage";

/**
 * In-memory implementation of SessionStorage.
 */
export class MemoryStorage implements SessionStorage {
    private data = new Map<string, string>();

    get(key: string): Promise<string | undefined> {
        return Promise.resolve(this.data.get(key));
    }

    set(key: string, value: string): Promise<void> {
        this.data.set(key, value);
        return Promise.resolve();
    }

    delete(key: string): Promise<void> {
        this.data.delete(key);
        return Promise.resolve();
    }

    clear(): Promise<void> {
        this.data.clear();
        return Promise.resolve();
    }
}
