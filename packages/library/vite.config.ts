/// <reference types="vitest/config" />

import { type UserConfig, defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import dts from "vite-plugin-dts";
import { globSync } from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

type Config = Required<UserConfig>;

const resolve: Config["resolve"] = {
    alias: {
        "@": fileURLToPath(new URL("src", import.meta.url)),
    },
};

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

const entries = globSync("src/**/index.ts").reduce(
    (acc, file) => {
        const relativePath = path.relative("src", file);
        const entryName = relativePath.replace(/\.ts$/, "").replace(/\\/g, "/");

        acc[entryName] = fileURLToPath(new URL(file, import.meta.url));
        return acc;
    },
    {} as Record<string, string>
);
export default defineConfig({
    build: {
        lib: {
            entry: entries,
            formats: ["es"],
            fileName: "index",
        },
        rolldownOptions: {
            external: [
                ...builtinModules,
                ...builtinModules.map((m) => `node:${m}`),
                "linkedom",
            ],
            output: {
                entryFileNames: "[name].js",
                chunkFileNames: "internal/[name]-[hash].js",
            },
        },
        outDir: "dist",
        sourcemap: true,
        minify: false,
    },
    clearScreen: false,
    plugins: [
        dts({
            tsconfigPath: "./tsconfig.app.json",
            outDirs: "dist",
            entryRoot: "src",
            include: ["src/**/*.ts"],
        }),
    ],
    resolve,
    test: testConfig,
});
