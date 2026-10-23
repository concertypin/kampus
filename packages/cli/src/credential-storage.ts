import {
    STORAGE_KEYS,
    type SessionStorage,
} from "@concertypin/ecampus-crawler";
import { pc } from "./commands/lib/format.ts";

/** The part of an `@napi-rs/keyring` `Entry` this module uses. */
export interface KeyringEntry {
    setPassword(password: string): void;
    /** `null` when the entry does not exist. */
    getPassword(): string | null;
    deletePassword(): boolean;
}

/** The part of the `@napi-rs/keyring` module this module uses. */
export interface KeyringModule {
    Entry: new (service: string, account: string) => KeyringEntry;
}

export interface KeychainCredentialStorageOptions {
    service: string;
    account: string;
    /** Defaults to `process.platform`. The keychain is used on `win32` only. */
    platform?: NodeJS.Platform;
    /** Defaults to a dynamic `import("@napi-rs/keyring")`. */
    loadKeyring?: () => Promise<KeyringModule>;
}

/** Where the stored credentials currently live. */
export type CredentialLocation = "keychain" | "file" | "none";

/** Whether the keychain warning was already printed in this process. */
let warned = false;

function warnKeychainUnavailable(): void {
    if (warned) return;
    warned = true;
    console.error(
        pc.yellow(
            "Warning: OS keychain unavailable; credentials are stored in the session file instead."
        )
    );
}

/** Thrown when the credentials could not be removed from the OS keychain. */
export class KeychainDeleteError extends Error {
    constructor() {
        super("Could not remove the credentials from the OS keychain");
        this.name = "KeychainDeleteError";
    }
}

/** Marks a failed keychain call; the caller falls back to the file. */
const KEYCHAIN_FAILED = Symbol("keychain failed");

/**
 * Keeps the `credentials` key in the Windows Credential Manager and every
 * other key in the wrapped file storage.
 *
 * On other platforms it is a pass-through to the file and never loads the
 * keyring module. On Windows, any keychain failure falls back to the file
 * for that call and prints one warning per process.
 */
export class KeychainCredentialStorage implements SessionStorage {
    private readonly file: SessionStorage;
    private readonly service: string;
    private readonly account: string;
    private readonly useKeychain: boolean;
    private readonly loadKeyring: () => Promise<KeyringModule>;
    private entry: KeyringEntry | undefined;
    private queue: Promise<void> = Promise.resolve();

    constructor(file: SessionStorage, opts: KeychainCredentialStorageOptions) {
        this.file = file;
        this.service = opts.service;
        this.account = opts.account;
        this.useKeychain = (opts.platform ?? process.platform) === "win32";
        this.loadKeyring =
            opts.loadKeyring ?? (() => import("@napi-rs/keyring"));
    }

    private isCredentials(key: string): boolean {
        return this.useKeychain && key === STORAGE_KEYS.credentials;
    }

    /** Creates the entry once and reuses it; undefined (after a warning) on failure. */
    private async getEntry(): Promise<KeyringEntry | undefined> {
        if (this.entry) return this.entry;
        try {
            const { Entry } = await this.loadKeyring();
            this.entry = new Entry(this.service, this.account);
            return this.entry;
        } catch {
            warnKeychainUnavailable();
            return undefined;
        }
    }

    /** Runs `fn` on the entry; `KEYCHAIN_FAILED` (after a warning) if it throws. */
    private async withEntry<T>(
        fn: (entry: KeyringEntry) => T
    ): Promise<T | typeof KEYCHAIN_FAILED> {
        const entry = await this.getEntry();
        if (!entry) return KEYCHAIN_FAILED;
        try {
            return fn(entry);
        } catch {
            warnKeychainUnavailable();
            return KEYCHAIN_FAILED;
        }
    }

    /** Writes `value`, reads it back and compares; removes the entry on a mismatch. */
    private static writeVerified(entry: KeyringEntry, value: string): true {
        entry.setPassword(value);
        if (entry.getPassword() === value) return true;
        // Do not leave a value behind that reads back differently.
        entry.deletePassword();
        throw new Error("Keychain read-back mismatch");
    }

    /** Moves `value` into the keychain and drops the file copy only once it reads back. */
    private async migrate(key: string, value: string): Promise<void> {
        const done = await this.withEntry((entry) =>
            KeychainCredentialStorage.writeVerified(entry, value)
        );
        if (done !== KEYCHAIN_FAILED) await this.file.delete(key);
    }

    /**
     * Serializes every operation, so a migration cannot interleave with another
     * call (including the file's read-modify-write of other keys).
     */
    private enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.queue.then(fn);
        this.queue = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    }

    get(key: string): Promise<string | undefined> {
        return this.enqueue(() => this.getNow(key));
    }

    set(key: string, value: string): Promise<void> {
        return this.enqueue(() => this.setNow(key, value));
    }

    delete(key: string): Promise<void> {
        return this.enqueue(() => this.deleteNow(key));
    }

    clear(): Promise<void> {
        return this.enqueue(() => this.clearNow());
    }

    /** Where the credentials currently live. */
    location(): Promise<CredentialLocation> {
        return this.enqueue(() => this.locationNow());
    }

    private async getNow(key: string): Promise<string | undefined> {
        if (!this.isCredentials(key)) return this.file.get(key);

        const stored = await this.withEntry((entry) => entry.getPassword());
        if (stored === KEYCHAIN_FAILED) return this.file.get(key);

        const fromFile = await this.file.get(key);
        if (fromFile === undefined) return stored ?? undefined;
        if (fromFile === stored) return stored;

        // A file copy next to a different keychain value only exists after a
        // failed keychain write, so it is the newer one. Plain-text copies from
        // older versions land here too when the keychain is empty.
        await this.migrate(key, fromFile);
        return fromFile;
    }

    private async setNow(key: string, value: string): Promise<void> {
        if (!this.isCredentials(key)) return this.file.set(key, value);

        const written = await this.withEntry((entry) =>
            KeychainCredentialStorage.writeVerified(entry, value)
        );
        if (written !== KEYCHAIN_FAILED) {
            await this.file.delete(key);
            return;
        }

        await this.file.set(key, value);
        // Best effort: a stale entry must not shadow this value once the
        // keychain works again.
        await this.withEntry((entry) => entry.deletePassword());
    }

    private async deleteNow(key: string): Promise<void> {
        const keychainRemoved = this.isCredentials(key)
            ? await this.withEntry((entry) => entry.deletePassword())
            : undefined;
        await this.file.delete(key);
        if (keychainRemoved === KEYCHAIN_FAILED)
            throw new KeychainDeleteError();
    }

    private async clearNow(): Promise<void> {
        const keychainRemoved = this.useKeychain
            ? await this.withEntry((entry) => entry.deletePassword())
            : undefined;
        await this.file.clear();
        if (keychainRemoved === KEYCHAIN_FAILED)
            throw new KeychainDeleteError();
    }

    private async locationNow(): Promise<CredentialLocation> {
        if (this.useKeychain) {
            const stored = await this.withEntry((entry) => entry.getPassword());
            if (stored !== KEYCHAIN_FAILED && stored) return "keychain";
        }
        const fromFile = await this.file.get(STORAGE_KEYS.credentials);
        return fromFile === undefined ? "none" : "file";
    }
}
