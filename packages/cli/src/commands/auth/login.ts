import { createInterface } from "node:readline";
import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";

async function readInputInteractive(prompt: string): Promise<string> {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });
    return new Promise<string>((resolve) => {
        rl.question(prompt, (answer) => {
            rl.close();
            resolve(answer.trimEnd());
        });
    });
}

async function readPasswordInteractive(prompt: string): Promise<string> {
    process.stdout.write(prompt);

    return new Promise<string>((resolve) => {
        const stdin = process.stdin;
        const wasRaw = stdin.isTTY;
        if (wasRaw) {
            stdin.setRawMode(true);
        }

        let password = "";

        const onData = (buf: Buffer): void => {
            const char = buf.toString("utf-8");

            if (char === "\r" || char === "\n") {
                cleanup();
                process.stdout.write("\n");
                resolve(password);
                return;
            }

            if (char === "\u0003") {
                // Ctrl+C
                cleanup();
                process.exit(0);
            }

            if (char === "\u0008" || char === "\u007f") {
                // Backspace
                if (password.length > 0) {
                    password = password.slice(0, -1);
                    process.stdout.write("\b \b");
                }
                return;
            }

            password += char;
            process.stdout.write("*");
        };

        const onError = (): void => {
            cleanup();
            resolve("");
        };

        const cleanup = (): void => {
            stdin.removeListener("data", onData);
            stdin.removeListener("error", onError);
            if (wasRaw) {
                stdin.setRawMode(false);
            }
            stdin.pause();
        };

        stdin.on("data", onData);
        stdin.on("error", onError);
        stdin.resume();
    });
}

function readInputPiped(): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.setEncoding("utf-8");
        process.stdin.on("data", (chunk: string) =>
            chunks.push(Buffer.from(chunk))
        );
        process.stdin.on("end", () =>
            resolve(Buffer.concat(chunks).toString("utf-8").trimEnd())
        );
        process.stdin.on("error", reject);
    });
}

export const loginCommand = new Command("login")
    .description("e-campus 로그인 후 세션을 로컬에 저장합니다")
    .argument("[id]", "학번 또는 아이디 (생략 시 stdin으로 입력)")
    .option("--force", "기존 세션이 유효해도 강제로 다시 로그인합니다", false)
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus auth login 202100000")}             ID를 인자로 전달, PW는 stdin
  ${pc.green("kampus auth login 202100000 --force")}    기존 세션 무시하고 재로그인
  ${pc.green("kampus auth login < input.txt")}          파이프 입력 (첫 줄=ID, 둘째 줄=PW)
  ${pc.green("kampus auth login")}                      인터랙티브 ID/PW 입력
`
    )
    .action(async (id: string | undefined, options: { force: boolean }) => {
        const crawler = createCrawler(getLogLevel());

        if (!options.force) {
            const existingValid = await crawler
                .checkSession()
                .catch(() => false);
            if (existingValid) {
                console.error(
                    `${pc.red("❌ 이미 유효한 세션이 존재합니다.")}\n  ${pc.dim(
                        "재로그인하려면 --force 플래그를 사용하세요:"
                    )} ${pc.green("kampus auth login --force")}`
                );
                process.exitCode = 1;
                return;
            }
        }

        let userId = id;
        let password = "";

        if (process.stdin.isTTY) {
            // Interactive mode: prompt for ID then password
            if (!userId) {
                userId = await readInputInteractive(pc.dim("학번/아이디: "));
            }
            if (!userId) {
                console.error(pc.red("❌ 학번/아이디가 필요합니다."));
                process.exitCode = 1;
                return;
            }
            password = await readPasswordInteractive(pc.dim("비밀번호: "));
        } else {
            // Piped mode: read stdin once, split by newline
            const input = await readInputPiped();
            const lines = input.split(/\r?\n/);
            if (!userId) {
                userId = lines[0];
                password = lines[1] ?? "";
            } else {
                password = lines[0] ?? "";
            }
            if (!userId) {
                console.error(pc.red("❌ 학번/아이디가 필요합니다."));
                process.exitCode = 1;
                return;
            }
        }

        if (!password) {
            console.error(pc.red("❌ 비밀번호가 필요합니다."));
            process.exitCode = 1;
            return;
        }

        process.stdout.write(pc.dim("로그인 중..."));
        try {
            await crawler.login(userId, password);
            console.log(
                `\r${pc.green("✅ 로그인 성공! 세션이 저장되었습니다.")}          `
            );
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\r${pc.red(`❌ 로그인 실패: ${message}`)}`);
            process.exitCode = 1;
        }
    });
