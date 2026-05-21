import { defineConfig } from "oxlint";
import eslintErrorConfig from "./oxlint-eslint-error.ts";
import eslintWarnConfig from "./oxlint-eslint-warn.ts";
export default defineConfig({
    $schema: "../../node_modules/oxlint/configuration_schema.json",
    extends: [eslintErrorConfig, eslintWarnConfig],
});
