/**
 * Minimal type declarations for Node.js built-in modules used by FileStorage.
 * The library must not depend on @types/node to maintain Deno compatibility.
 * FileStorage throws at runtime if used outside Node.js.
 */

declare module "node:fs/promises" {
    export function readFile(path: string, encoding: string): Promise<string>;
    export function writeFile(
        path: string,
        data: string,
        encoding: string
    ): Promise<void>;
    export function mkdir(
        path: string,
        options?: { recursive?: boolean }
    ): Promise<void>;
    export function unlink(path: string): Promise<void>;
}

declare module "node:path" {
    export function dirname(path: string): string;
}
