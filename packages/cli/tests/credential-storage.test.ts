import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    MemoryStorage,
    STORAGE_KEYS,
    type SessionStorage,
} from "@concertypin/ecampus-crawler";
import type {
    KeychainCredentialStorage,
    KeyringEntry,
    KeyringModule,
} from "@/credential-storage";

const SERVICE = "kampus";
const ACCOUNT = "https://example.test";
const SECRET = JSON.stringify({ username: "u", password: "p" });

type FailOn = "none" | "constructor" | "set" | "get" | "delete";

function createModule(fake: FakeKeyring): KeyringModule {
    return {
        Entry: class implements KeyringEntry {
            private readonly id: string;
            constructor(service: string, account: string) {
                if (fake.failOn === "constructor") {
                    throw new Error("constructor failed");
                }
                fake.created.push([service, account]);
                this.id = `${service}\u0000${account}`;
            }
            setPassword(password: string): void {
                if (fake.failOn === "set") throw new Error("set failed");
                fake.store.set(this.id, password);
            }
            getPassword(): string | null {
                if (fake.failOn === "get") throw new Error("get failed");
                const stored = fake.store.get(this.id) ?? null;
                // Only a written entry can read back differently.
                if (stored !== null && fake.readBack !== undefined) {
                    return fake.readBack;
                }
                return stored;
            }
            deletePassword(): boolean {
                if (fake.failOn === "delete" || fake.failDelete) {
                    throw new Error("delete failed");
                }
                return fake.store.delete(this.id);
            }
        },
    };
}

/**
 * A file stand-in with the same non-atomic read-modify-write as FileStorage,
 * made slow so that unserialized calls visibly overwrite each other.
 */
class SlowFile implements SessionStorage {
    data: Record<string, string> = {};
    private tick(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async get(key: string): Promise<string | undefined> {
        await this.tick(5);
        return this.data[key];
    }
    async set(key: string, value: string): Promise<void> {
        const copy = { ...this.data };
        await this.tick(30);
        copy[key] = value;
        this.data = copy;
    }
    async delete(key: string): Promise<void> {
        const copy = { ...this.data };
        await this.tick(5);
        delete copy[key];
        this.data = copy;
    }
    clear(): Promise<void> {
        this.data = {};
        return Promise.resolve();
    }
}

/** An in-memory stand-in for `@napi-rs/keyring`. */
class FakeKeyring {
    readonly store = new Map<string, string>();
    readonly created: [string, string][] = [];
    failOn: FailOn = "none";
    /** Makes `deletePassword` throw on top of `failOn`. */
    failDelete = false;
    /** When set, `getPassword` returns this instead of the stored value. */
    readBack: string | null | undefined;

    readonly module: KeyringModule = createModule(this);

    get stored(): string | undefined {
        return this.store.get(`${SERVICE}\u0000${ACCOUNT}`);
    }

    seed(value: string): void {
        this.store.set(`${SERVICE}\u0000${ACCOUNT}`, value);
    }
}

describe("KeychainCredentialStorage", () => {
    let Storage: typeof KeychainCredentialStorage;
    let KeychainDeleteError: typeof import("@/credential-storage").KeychainDeleteError;
    let keyring: FakeKeyring;
    let file: MemoryStorage;
    let loadKeyring: ReturnType<typeof vi.fn<() => Promise<KeyringModule>>>;
    let errors: string[];

    function create(
        platform: NodeJS.Platform = "win32"
    ): KeychainCredentialStorage {
        return new Storage(file, {
            service: SERVICE,
            account: ACCOUNT,
            platform,
            loadKeyring,
        });
    }

    beforeEach(async () => {
        // The one-warning-per-process flag lives in the module.
        vi.resetModules();
        ({ KeychainCredentialStorage: Storage, KeychainDeleteError } =
            await import("@/credential-storage"));
        keyring = new FakeKeyring();
        file = new MemoryStorage();
        loadKeyring = vi
            .fn<() => Promise<KeyringModule>>()
            .mockResolvedValue(keyring.module);
        errors = [];
        vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            errors.push(args.map(String).join(" "));
        });
    });

    describe("on win32", () => {
        it("keeps credentials in the keychain and the session in the file", async () => {
            const storage = create();
            await storage.set(STORAGE_KEYS.credentials, SECRET);
            await storage.set(STORAGE_KEYS.session, "cookie");

            expect(keyring.stored).toBe(SECRET);
            expect(keyring.created).toEqual([[SERVICE, ACCOUNT]]);
            expect(await file.get(STORAGE_KEYS.credentials)).toBeUndefined();
            expect(await file.get(STORAGE_KEYS.session)).toBe("cookie");
            expect(await storage.get(STORAGE_KEYS.credentials)).toBe(SECRET);
            expect(await storage.get(STORAGE_KEYS.session)).toBe("cookie");
            expect(errors).toEqual([]);
        });

        it("does not touch the keychain for the session key", async () => {
            const storage = create();
            await storage.set(STORAGE_KEYS.session, "cookie");
            await storage.get(STORAGE_KEYS.session);
            await storage.delete(STORAGE_KEYS.session);

            expect(loadKeyring).not.toHaveBeenCalled();
        });

        it("creates the entry lazily and only once", async () => {
            const storage = create();
            expect(loadKeyring).not.toHaveBeenCalled();

            await storage.set(STORAGE_KEYS.credentials, SECRET);
            await storage.get(STORAGE_KEYS.credentials);
            await storage.get(STORAGE_KEYS.credentials);

            expect(loadKeyring).toHaveBeenCalledTimes(1);
            expect(keyring.created).toHaveLength(1);
        });

        it("returns undefined when neither store has credentials", async () => {
            expect(
                await create().get(STORAGE_KEYS.credentials)
            ).toBeUndefined();
        });

        describe("migration from the file", () => {
            it("moves plain-text credentials to the keychain and removes the file copy", async () => {
                await file.set(STORAGE_KEYS.credentials, SECRET);
                await file.set(STORAGE_KEYS.session, "cookie");

                const value = await create().get(STORAGE_KEYS.credentials);

                expect(value).toBe(SECRET);
                expect(keyring.stored).toBe(SECRET);
                expect(
                    await file.get(STORAGE_KEYS.credentials)
                ).toBeUndefined();
                expect(await file.get(STORAGE_KEYS.session)).toBe("cookie");
                expect(errors).toEqual([]);
            });

            it("prefers a differing file copy (newer) and migrates it over the keychain value", async () => {
                keyring.seed("stale-keychain");
                await file.set(STORAGE_KEYS.credentials, SECRET);

                expect(await create().get(STORAGE_KEYS.credentials)).toBe(
                    SECRET
                );
                expect(keyring.stored).toBe(SECRET);
                expect(
                    await file.get(STORAGE_KEYS.credentials)
                ).toBeUndefined();
            });

            it("keeps the newer file copy when overwriting the keychain fails", async () => {
                keyring.seed("stale-keychain");
                await file.set(STORAGE_KEYS.credentials, SECRET);
                keyring.failOn = "set";

                expect(await create().get(STORAGE_KEYS.credentials)).toBe(
                    SECRET
                );
                expect(await file.get(STORAGE_KEYS.credentials)).toBe(SECRET);
                expect(errors).toHaveLength(1);
            });

            it("returns the keychain value when the file holds the same one", async () => {
                keyring.seed(SECRET);
                await file.set(STORAGE_KEYS.credentials, SECRET);

                expect(await create().get(STORAGE_KEYS.credentials)).toBe(
                    SECRET
                );
            });

            it("keeps the file copy and warns when the read-back differs", async () => {
                await file.set(STORAGE_KEYS.credentials, SECRET);
                keyring.readBack = "something else";

                const value = await create().get(STORAGE_KEYS.credentials);

                expect(value).toBe(SECRET);
                expect(await file.get(STORAGE_KEYS.credentials)).toBe(SECRET);
                // The mismatching entry is removed so it is never read later.
                expect(keyring.stored).toBeUndefined();
                expect(errors).toHaveLength(1);
            });

            it("keeps the file copy and warns when the keychain write fails", async () => {
                await file.set(STORAGE_KEYS.credentials, SECRET);
                keyring.failOn = "set";

                const value = await create().get(STORAGE_KEYS.credentials);

                expect(value).toBe(SECRET);
                expect(await file.get(STORAGE_KEYS.credentials)).toBe(SECRET);
                expect(errors).toHaveLength(1);
            });
        });

        it("removes the plain-text copy when credentials are set", async () => {
            await file.set(STORAGE_KEYS.credentials, "old plain text");

            await create().set(STORAGE_KEYS.credentials, SECRET);

            expect(keyring.stored).toBe(SECRET);
            expect(await file.get(STORAGE_KEYS.credentials)).toBeUndefined();
        });

        it("deletes the credentials from both stores", async () => {
            keyring.seed(SECRET);
            await file.set(STORAGE_KEYS.credentials, SECRET);
            await file.set(STORAGE_KEYS.session, "cookie");

            await create().delete(STORAGE_KEYS.credentials);

            expect(keyring.stored).toBeUndefined();
            expect(await file.get(STORAGE_KEYS.credentials)).toBeUndefined();
            expect(await file.get(STORAGE_KEYS.session)).toBe("cookie");
        });

        it("clears both stores", async () => {
            keyring.seed(SECRET);
            await file.set(STORAGE_KEYS.credentials, SECRET);
            await file.set(STORAGE_KEYS.session, "cookie");

            await create().clear();

            expect(keyring.stored).toBeUndefined();
            expect(await file.get(STORAGE_KEYS.credentials)).toBeUndefined();
            expect(await file.get(STORAGE_KEYS.session)).toBeUndefined();
        });

        describe("when removing from the keychain fails", () => {
            it("delete still cleans the file, then throws without secrets", async () => {
                keyring.seed(SECRET);
                keyring.failDelete = true;
                await file.set(STORAGE_KEYS.credentials, SECRET);

                const error: unknown = await create()
                    .delete(STORAGE_KEYS.credentials)
                    .catch((err: unknown) => err);

                expect(error).toBeInstanceOf(KeychainDeleteError);
                expect(String(error)).not.toContain(SECRET);
                expect(
                    await file.get(STORAGE_KEYS.credentials)
                ).toBeUndefined();
            });

            it("clear still cleans the file, then throws", async () => {
                keyring.failDelete = true;
                await file.set(STORAGE_KEYS.credentials, SECRET);
                await file.set(STORAGE_KEYS.session, "cookie");

                await expect(create().clear()).rejects.toBeInstanceOf(
                    KeychainDeleteError
                );
                expect(
                    await file.get(STORAGE_KEYS.credentials)
                ).toBeUndefined();
                expect(await file.get(STORAGE_KEYS.session)).toBeUndefined();
            });

            it("throws when the keyring cannot be loaded", async () => {
                loadKeyring.mockRejectedValue(new Error("no native binary"));

                await expect(
                    create().delete(STORAGE_KEYS.credentials)
                ).rejects.toBeInstanceOf(KeychainDeleteError);
            });

            it("does not throw when there is no entry", async () => {
                await expect(
                    create().delete(STORAGE_KEYS.credentials)
                ).resolves.toBeUndefined();
            });
        });

        describe("set() when the keychain write fails", () => {
            it("stores the value in the file and removes a stale keychain entry", async () => {
                keyring.seed("stale-keychain");
                keyring.failOn = "set";
                const storage = create();

                await storage.set(STORAGE_KEYS.credentials, SECRET);
                keyring.failOn = "none"; // the keychain recovers

                expect(await file.get(STORAGE_KEYS.credentials)).toBe(SECRET);
                expect(keyring.stored).toBeUndefined();
                expect(await storage.get(STORAGE_KEYS.credentials)).toBe(
                    SECRET
                );
                expect(errors).toHaveLength(1);
            });

            it("keeps going and warns once when removing the stale entry fails too", async () => {
                keyring.seed("stale-keychain");
                keyring.failOn = "set";
                keyring.failDelete = true;

                await create().set(STORAGE_KEYS.credentials, SECRET);

                expect(await file.get(STORAGE_KEYS.credentials)).toBe(SECRET);
                expect(errors).toHaveLength(1);
            });

            it("lets the file copy win over the stale entry after recovery", async () => {
                keyring.seed("stale-keychain");
                keyring.failOn = "set";
                keyring.failDelete = true;
                const storage = create();
                await storage.set(STORAGE_KEYS.credentials, SECRET);
                keyring.failOn = "none";
                keyring.failDelete = false;

                expect(await storage.get(STORAGE_KEYS.credentials)).toBe(
                    SECRET
                );
                expect(keyring.stored).toBe(SECRET);
                expect(
                    await file.get(STORAGE_KEYS.credentials)
                ).toBeUndefined();
            });
        });

        describe("set() read-back", () => {
            it("keeps the new value in the file and warns when the read-back differs", async () => {
                await file.set(STORAGE_KEYS.credentials, "old plain text");
                keyring.readBack = "something else";

                await create().set(STORAGE_KEYS.credentials, SECRET);

                expect(await file.get(STORAGE_KEYS.credentials)).toBe(SECRET);
                expect(keyring.stored).toBeUndefined();
                expect(errors).toHaveLength(1);
            });

            it("keeps the file copy and warns when the read-back throws", async () => {
                keyring.failOn = "get";

                await create().set(STORAGE_KEYS.credentials, SECRET);

                expect(await file.get(STORAGE_KEYS.credentials)).toBe(SECRET);
                expect(errors).toHaveLength(1);
            });
        });

        describe("concurrency", () => {
            function createOn(slow: SessionStorage): KeychainCredentialStorage {
                return new Storage(slow, {
                    service: SERVICE,
                    account: ACCOUNT,
                    platform: "win32",
                    loadKeyring,
                });
            }

            it("two concurrent get() calls both return the migrated credentials", async () => {
                const slow = new SlowFile();
                slow.data[STORAGE_KEYS.credentials] = SECRET;
                const storage = createOn(slow);

                const values = await Promise.all([
                    storage.get(STORAGE_KEYS.credentials),
                    storage.get(STORAGE_KEYS.credentials),
                ]);

                expect(values).toEqual([SECRET, SECRET]);
                expect(keyring.stored).toBe(SECRET);
                expect(slow.data[STORAGE_KEYS.credentials]).toBeUndefined();
            });

            it("a concurrent session write keeps both it and the migration", async () => {
                const slow = new SlowFile();
                slow.data[STORAGE_KEYS.credentials] = SECRET;
                slow.data[STORAGE_KEYS.session] = "old";
                const storage = createOn(slow);

                const [value] = await Promise.all([
                    storage.get(STORAGE_KEYS.credentials),
                    storage.set(STORAGE_KEYS.session, "new"),
                ]);

                expect(value).toBe(SECRET);
                expect(keyring.stored).toBe(SECRET);
                expect(slow.data[STORAGE_KEYS.session]).toBe("new");
                expect(slow.data[STORAGE_KEYS.credentials]).toBeUndefined();
            });

            it("keeps working after a failed operation", async () => {
                const storage = create();
                keyring.failDelete = true;
                await expect(
                    storage.delete(STORAGE_KEYS.credentials)
                ).rejects.toBeInstanceOf(KeychainDeleteError);
                keyring.failDelete = false;

                await storage.set(STORAGE_KEYS.credentials, SECRET);
                expect(await storage.get(STORAGE_KEYS.credentials)).toBe(
                    SECRET
                );
            });
        });

        describe("when the keyring cannot be loaded", () => {
            beforeEach(() => {
                loadKeyring.mockRejectedValue(new Error("no native binary"));
            });

            it("falls back to the file and warns exactly once", async () => {
                const storage = create();

                await storage.set(STORAGE_KEYS.credentials, SECRET);
                expect(await storage.get(STORAGE_KEYS.credentials)).toBe(
                    SECRET
                );
                await storage.set(STORAGE_KEYS.credentials, SECRET);

                expect(await file.get(STORAGE_KEYS.credentials)).toBe(SECRET);
                expect(errors).toHaveLength(1);
                expect(errors[0]).toContain("keychain");
            });

            it("warns once per process even across storage instances", async () => {
                await create().get(STORAGE_KEYS.credentials);
                await create().get(STORAGE_KEYS.credentials);

                expect(errors).toHaveLength(1);
            });

            it("does not warn when only the session key is used", async () => {
                await create().set(STORAGE_KEYS.session, "cookie");
                expect(errors).toEqual([]);
            });
        });

        describe.each([
            ["constructor", SECRET],
            ["set", SECRET],
            ["get", SECRET],
        ] as const)(
            "when the keyring %s call fails",
            (failOn, expectedValue) => {
                it("falls back to the file and warns exactly once", async () => {
                    keyring.failOn = failOn;
                    const storage = create();

                    await storage.set(STORAGE_KEYS.credentials, SECRET);
                    const value = await storage.get(STORAGE_KEYS.credentials);
                    expect(value).toBe(expectedValue);
                    expect(errors).toHaveLength(1);
                });
            }
        );

        describe("location()", () => {
            it("reports the keychain", async () => {
                keyring.seed(SECRET);
                expect(await create().location()).toBe("keychain");
            });

            it("reports the file for plain-text credentials", async () => {
                await file.set(STORAGE_KEYS.credentials, SECRET);
                expect(await create().location()).toBe("file");
            });

            it("reports none when nothing is stored", async () => {
                expect(await create().location()).toBe("none");
            });

            it("reports the file when the keychain is unavailable", async () => {
                loadKeyring.mockRejectedValue(new Error("nope"));
                await file.set(STORAGE_KEYS.credentials, SECRET);

                expect(await create().location()).toBe("file");
                expect(errors).toHaveLength(1);
            });

            it("does not migrate", async () => {
                await file.set(STORAGE_KEYS.credentials, SECRET);
                await create().location();

                expect(keyring.stored).toBeUndefined();
                expect(await file.get(STORAGE_KEYS.credentials)).toBe(SECRET);
            });
        });
    });

    describe.each(["linux", "darwin"] as const)("on %s", (platform) => {
        it("passes everything through to the file without loading the keyring", async () => {
            const storage = create(platform);

            await storage.set(STORAGE_KEYS.credentials, SECRET);
            await storage.set(STORAGE_KEYS.session, "cookie");
            expect(await storage.get(STORAGE_KEYS.credentials)).toBe(SECRET);
            expect(await file.get(STORAGE_KEYS.credentials)).toBe(SECRET);
            await storage.delete(STORAGE_KEYS.session);
            await storage.clear();

            expect(await file.get(STORAGE_KEYS.credentials)).toBeUndefined();
            expect(loadKeyring).not.toHaveBeenCalled();
            expect(errors).toEqual([]);
        });

        it("reports the location from the file only", async () => {
            const storage = create(platform);
            expect(await storage.location()).toBe("none");
            await file.set(STORAGE_KEYS.credentials, SECRET);
            expect(await storage.location()).toBe("file");

            expect(loadKeyring).not.toHaveBeenCalled();
            expect(errors).toEqual([]);
        });
    });
});
