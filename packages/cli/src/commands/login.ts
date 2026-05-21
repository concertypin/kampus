import { createInterface } from "node:readline";
import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../crawler.ts";
import { getLogLevel } from "../index.ts";

async function readPasswordInteractive(): Promise<string> {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });
    return new Promise<string>((resolve) => {
        rl.question(pc.dim("비밀번호: "), (answer) => {
            rl.close();
            resolve(answer.trimEnd());
        });
    });
}

function readPasswordPiped(): Promise<string> {
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
    .argument("<id>", "학번 또는 아이디")
    .argument("[password]", "비밀번호 (생략 시 stdin으로 입력 받음)")
    .option("--force", "기존 세션이 유효해도 강제로 다시 로그인합니다", false)
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus login 202100000 mypassword")}      비밀번호를 인자로 전달
  ${pc.green("kampus login 202100000 --force")}         기존 세션 무시하고 재로그인
  ${pc.green("kampus login 202100000 < password.txt")}  파일에서 비밀번호 읽기
  ${pc.green("kampus login 202100000")}                 인터랙티브 비밀번호 입력
`
    )
    .action(
        async (
            id: string,
            password: string | undefined,
            options: { force: boolean }
        ) => {
            const crawler = createCrawler(getLogLevel());

            if (!options.force) {
                const existingValid = await crawler
                    .checkSession()
                    .catch(() => false);
                if (existingValid) {
                    console.error(
                        `${pc.red(
                            "❌ 이미 유효한 세션이 존재합니다."
                        )}\n  ${pc.dim(
                            "재로그인하려면 --force 플래그를 사용하세요:"
                        )} ${pc.green("kampus login <id> --force")}`
                    );
                    process.exitCode = 1;
                    return;
                }
            }

            if (!password) {
                password = process.stdin.isTTY
                    ? await readPasswordInteractive()
                    : (process.stdout.write(pc.dim("비밀번호: ")),
                      await readPasswordPiped());
                if (!password) {
                    console.error(
                        `\n${pc.red("❌ 비밀번호가 입력되지 않았습니다.")}`
                    );
                    process.exitCode = 1;
                    return;
                }
            }

            process.stdout.write(pc.dim("로그인 중..."));

            try {
                await crawler.login(id, password);
                const valid = await crawler.checkSession();
                if (!valid) {
                    console.error(
                        `\n${pc.red(
                            "❌ 로그인 실패: 아이디 또는 비밀번호를 확인해주세요."
                        )}`
                    );
                    process.exitCode = 1;
                    return;
                }
                console.log(
                    `\n${pc.green("✓ 로그인 성공! 세션이 저장되었습니다.")}`
                );
            } catch (err: unknown) {
                const message =
                    err instanceof Error ? err.message : String(err);
                console.error(`\n${pc.red(`❌ 오류: ${message}`)}`);
                process.exitCode = 1;
            }
        }
    );
