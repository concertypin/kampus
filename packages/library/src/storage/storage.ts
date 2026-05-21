/**
 * Session storage interface for persisting authentication data.
 * Similar to web's Storage interface, but asynchronous (Promise-based).
 */
export interface SessionStorage {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
}
