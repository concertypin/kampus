/**
 * Minimal type declarations for cross-platform (Node.js / Deno) environment detection.
 * The library must not depend on @types/node to maintain Deno compatibility.
 *
 * These ambient declarations are only active within the library's own compilation
 * (tsconfig.app.json). Downstream projects using project references (such as tests)
 * do NOT inherit these declarations — they use their own @types/node if needed.
 */

declare let Deno:
    | {
          version: { deno: string };
      }
    | undefined;

declare let process:
    | {
          versions?: { node?: string };
      }
    | undefined;
