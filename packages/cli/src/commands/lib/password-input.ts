import { type Writable } from "node:stream";

interface PasswordInputOptions {
    /** Readable stream for input (default: process.stdin) */
    input: NodeJS.ReadStream & {
        isTTY: boolean;
        setRawMode(mode: boolean): void;
    };
    /** Writable stream for output (default: process.stdout) */
    output: Writable;
}

/**
 * Read a password from stdin with masked output.
 * Characters are echoed as '*' and backspace is handled.
 *
 * @param prompt - Text to display before reading
 * @param opts - Optional I/O stream overrides (for testing)
 * @returns The password string (empty on error/Ctrl+C before Enter)
 */
export async function readPasswordInteractive(
    prompt: string,
    opts?: PasswordInputOptions
): Promise<string> {
    const input = opts?.input ?? process.stdin;
    const output = opts?.output ?? process.stdout;

    output.write(prompt);

    return new Promise<string>((resolve) => {
        const wasRaw = input.isTTY;
        if (wasRaw) {
            input.setRawMode(true);
        }

        let password = "";

        const onData = (buf: Buffer): void => {
            const str = buf.toString("utf-8");

            for (const char of str) {
                if (char === "\r" || char === "\n") {
                    cleanup();
                    output.write("\n");
                    resolve(password);
                    return;
                }

                if (char === "\u0003") {
                    // Ctrl+C
                    cleanup();
                    output.write("\n");
                    resolve("");
                    return;
                }

                if (char === "\u0008" || char === "\u007f") {
                    // Backspace
                    if (password.length > 0) {
                        password = password.slice(0, -1);
                        output.write("\b \b");
                    }
                    continue;
                }

                password += char;
                output.write("*");
            }
        };

        const onError = (): void => {
            cleanup();
            resolve("");
        };

        const cleanup = (): void => {
            input.removeListener("data", onData);
            input.removeListener("error", onError);
            if (wasRaw) {
                input.setRawMode(false);
            }
            input.pause();
        };

        input.on("data", onData);
        input.on("error", onError);
        input.resume();
    });
}
