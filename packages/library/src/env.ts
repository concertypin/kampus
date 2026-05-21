/**
 * Runtime environment detection for cross-platform (Node.js / Deno) support.
 * The library must work in both Node.js and Deno environments.
 */

/** True if running in Deno */
export const isDeno = typeof Deno !== "undefined";

/** True if running in Node.js */
export const isNode =
    typeof process !== "undefined" && process.versions?.node !== undefined;
