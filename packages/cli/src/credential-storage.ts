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
            "⚠️ OS 키체인(Windows 자격 증명 관리자)을 사용할 수 없어 인증 정보를 세션 파일에 저장합니다."
        )
    );
}

/**
 * Thrown when the credentials could not be removed from the OS keychain.
 * The message is fixed; the keyring's own error is the `cause`.
 */
export class KeychainDeleteError extends Error {
    constructor(options?: ErrorOptions) {
        super("Could not remove the credentials from the OS keychain", options);
        this.name = "KeychainDeleteError";
    }
}

/** Marks a failed keychain call; the caller falls back to the file. */
const KEYCHAIN_FAILED = Symbol("keychain failed");

/** The outcome of a keychain call, with the error when it failed. */
/**
 * One queue for every instance in the process. The CLI creates more than one
 * storage over the same session file and keychain entry (the crawler, and
 * `getCredentialLocation`), so a per-instance queue would let a migration in
 * one interleave with a set() or delete() in another and bring back the old
 * value.
 */
let sharedQueue: Promise<void> = Promise.resolve();

type KeychainResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

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

    constructor(file: SessionStorage, opts: KeychainCredentialStorageOptions) {
        // Every instance shares one queue, so an instance waiting on the one
        // it wraps would wait on itself.
        if (file instanceof KeychainCredentialStorage) {
            throw new Error(
                "KeychainCredentialStorage cannot wrap another KeychainCredentialStorage"
            );
        }
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

    /** Creates the entry once and reuses it; throws if the keyring cannot be loaded. */
    private async getEntry(): Promise<KeyringEntry> {
        if (this.entry) return this.entry;
        const { Entry } = await this.loadKeyring();
        this.entry = new Entry(this.service, this.account);
        return this.entry;
    }

    /**
     * Runs `fn` on the entry and reports the error if loading the keyring or
     * `fn` throws (after a warning).
     */
    private async tryEntry<T>(
        fn: (entry: KeyringEntry) => T
    ): Promise<KeychainResult<T>> {
        try {
            const entry = await this.getEntry();
            return { ok: true, value: fn(entry) };
        } catch (error: unknown) {
            warnKeychainUnavailable();
            return { ok: false, error };
        }
    }

    /** Runs `fn` on the entry; `KEYCHAIN_FAILED` (after a warning) if it throws. */
    private async withEntry<T>(
        fn: (entry: KeyringEntry) => T
    ): Promise<T | typeof KEYCHAIN_FAILED> {
        const result = await this.tryEntry(fn);
        return result.ok ? result.value : KEYCHAIN_FAILED;
    }

    /** Writes `value`, reads it back and compares; removes the entry on a mismatch. */
    private static writeVerified(entry: KeyringEntry, value: string): true {
        entry.setPassword(value);
        if (entry.getPassword() === value) return true;
        // Do not leave a value behind that reads back differently.
        entry.deletePassword();
        throw new Error("Keychain read-back mismatch");
    }

    /**
     * Moves `value` into the keychain and drops the file copy only once it
     * reads back. Dropping it is best effort, like the duplicate cleanup in
     * get(): the value is safe in the keychain, the read must not fail, and
     * the next get() finds an identical copy and tries again.
     */
    private async migrate(key: string, value: string): Promise<void> {
        const done = await this.withEntry((entry) =>
            KeychainCredentialStorage.writeVerified(entry, value)
        );
        if (done !== KEYCHAIN_FAILED) {
            await this.file.delete(key).catch(() => undefined);
        }
    }

    /**
     * Serializes every operation of every instance in the process, so a
     * migration cannot interleave with another call (including the file's
     * read-modify-write of other keys).
     */
    private enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const result = sharedQueue.then(fn);
        sharedQueue = result.then(
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

    /** Where the credentials currently live (after a migration, if one was due). */
    location(): Promise<CredentialLocation> {
        return this.enqueue(() => this.locationNow());
    }

    private async getNow(key: string): Promise<string | undefined> {
        if (!this.isCredentials(key)) return this.file.get(key);

        const stored = await this.withEntry((entry) => entry.getPassword());
        if (stored === KEYCHAIN_FAILED) return this.file.get(key);

        const fromFile = await this.file.get(key);
        if (fromFile === undefined) return stored ?? undefined;
        if (fromFile === stored) {
            // A plain-text duplicate left by a set() whose file cleanup
            // failed. Removing it is best effort: the value is safe in the
            // keychain, and the next call tries again.
            await this.file.delete(key).catch(() => undefined);
            return stored;
        }

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
            await this.dropFileCopy(key, value);
            return;
        }

        await this.file.set(key, value);
        // Best effort: a stale entry must not shadow this value once the
        // keychain works again.
        await this.withEntry((entry) => entry.deletePassword());
    }

    /**
     * Removes the plain-text copy after `value` reached the keychain. If that
     * fails, the copy is overwritten with `value` instead, so an older value
     * cannot be taken for the newer one and migrated over the keychain later
     * (get() removes the duplicate). Only when both fail does the error
     * reach the caller.
     */
    private async dropFileCopy(key: string, value: string): Promise<void> {
        if ((await this.file.get(key)) === undefined) return;
        try {
            await this.file.delete(key);
        } catch (err: unknown) {
            await this.file.set(key, value).catch(() => {
                throw err;
            });
        }
    }

    private async deleteNow(key: string): Promise<void> {
        const keychainRemoved = this.isCredentials(key)
            ? await this.tryEntry((entry) => entry.deletePassword())
            : undefined;
        await this.file.delete(key);
        if (keychainRemoved && !keychainRemoved.ok) {
            throw new KeychainDeleteError({ cause: keychainRemoved.error });
        }
    }

    private async clearNow(): Promise<void> {
        const keychainRemoved = this.useKeychain
            ? await this.tryEntry((entry) => entry.deletePassword())
            : undefined;
        await this.file.clear();
        if (keychainRemoved && !keychainRemoved.ok) {
            throw new KeychainDeleteError({ cause: keychainRemoved.error });
        }
    }

    /**
     * Reads the credentials like get() first, so plain-text credentials from
     * an older version are moved into the keychain by `auth check` as well.
     */
    private async locationNow(): Promise<CredentialLocation> {
        const value = await this.getNow(STORAGE_KEYS.credentials);
        if (value === undefined) return "none";
        const inFile = await this.file.get(STORAGE_KEYS.credentials);
        return inFile === undefined ? "keychain" : "file";
    }
}
