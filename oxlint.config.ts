import { defineConfig } from "oxlint";
import eslintConfig from "./scripts/linter/oxlint-eslint.ts";
export default defineConfig({
    plugins: ["typescript", "unicorn", "import", "vitest", "promise"],
    env: {
        builtin: true,
    },
    ignorePatterns: [
        "**/node_modules/**",
        "**/dist/**",
        "**/dist-ts/**",
        "**/coverage/**",
        "**/.cache/**",
        "**/.vscode/**",
        "**/.git/**",
        "scripts/**",
    ],
    overrides: [
        {
            files: ["**/*.d.ts"],
            rules: {
                "no-unused-vars": "off",
            },
        },
        {
            files: ["scripts/**/*.ts", "packages/cli/**/*.ts"],
            rules: {
                "no-console": "off",
            },
        },
        {
            files: ["packages/library/tests/**/*.test.ts"],
            rules: {
                "vitest/no-disabled-tests": "off",
            },
        },
    ],
    options: {
        denyWarnings: true,
        reportUnusedDisableDirectives: "error",
        typeAware: true,
        typeCheck: true,
    },
    extends: [eslintConfig],
});
