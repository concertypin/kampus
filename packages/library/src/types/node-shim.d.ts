/**
 * Minimal type declarations for Node.js built-in modules used by FileStorage.
 * The library must not depend on @types/node to maintain Deno compatibility.
 * FileStorage throws at runtime if used outside Node.js.
 */

declare module "node:fs/promises" {
    export function readFile(path: string, encoding: string): Promise<string>;
    export function writeFile(
        path: string,
        data: string | Uint8Array,
        options?: string | { encoding?: string; mode?: number; flag?: string }
    ): Promise<void>;
    export function rename(oldPath: string, newPath: string): Promise<void>;
    export function mkdir(
        path: string,
        options?: { recursive?: boolean; mode?: number }
    ): Promise<void>;
    export function unlink(path: string): Promise<void>;
    export function chmod(path: string, mode: number): Promise<void>;
}

declare module "node:path" {
    export function dirname(path: string): string;
    export function resolve(...paths: string[]): string;
}
