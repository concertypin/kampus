// Keep it light for test setups,
// Since all tests will slow down if this file is heavy.
import { vi } from "vitest";

// Tests must never reach the real OS keychain: every `Entry` throws.
vi.mock("@napi-rs/keyring", () => ({
    Entry: class {
        constructor() {
            throw new Error("The real OS keychain is not available in tests");
        }
    },
}));
