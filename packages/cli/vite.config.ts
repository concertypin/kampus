/// <reference types="vitest/config" />

import { type UserConfig, defineConfig } from "vite";
import { fileURLToPath } from "node:url";
type Config = Required<UserConfig>;

const resolve: Config["resolve"] = {
    alias: {
        "@": fileURLToPath(new URL("src", import.meta.url)),
    },
};

/**
 * Vite plugin that prepends a shebang line to the CLI entry file.
 * This is needed to make the output executable via `node` or directly.
 */
function shebangPlugin(): NonNullable<Config["plugins"]>[number] {
    return {
        name: "shebang",
        generateBundle(_options, bundle) {
            for (const [fileName, chunk] of Object.entries(bundle)) {
                if (chunk.type === "chunk" && fileName === "index.js") {
                    chunk.code = `#!/usr/bin/env node\n${chunk.code}`;
                }
            }
        },
    };
}

const testConfig: Config["test"] = {
    coverage: {
        enabled: true,
        include: ["src/**/*.ts"],
        provider: "v8",
        reportOnFailure: true,
        reporter: ["text", "json-summary", "html"],
    },
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
    globals: true,
    include: ["tests/**/*.test.ts"],
    setupFiles: "./tests/setup.ts",
};
export default defineConfig({
    test: testConfig,
    build: {
        lib: {
            entry: fileURLToPath(new URL("src/index.ts", import.meta.url)),
            formats: ["es"],
            fileName: "index",
        },
        rolldownOptions: {
            output: {
                entryFileNames: "[name].js",
                chunkFileNames: "internal/[name]-[hash].js",
            },
        },
        outDir: "dist",
        sourcemap: true,
        minify: false,
        ssr: true,
    },
    clearScreen: false,
    plugins: [shebangPlugin()],
    resolve,
});
