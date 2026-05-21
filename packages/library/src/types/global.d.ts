/**
 * Minimal type declarations for cross-platform (Node.js / Deno) environment detection.
 * The library must not depend on @types/node to maintain Deno compatibility.
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
