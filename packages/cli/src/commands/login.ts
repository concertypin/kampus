import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../crawler.ts";

export const loginCommand = new Command("login")
    .description("e-campus 로그인 후 세션을 로컬에 저장합니다")
    .argument("<id>", "학번 또는 아이디")
    .argument("<password>", "비밀번호")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus login 2021000000 mypassword")}
`
    )
    .action(async (id: string, password: string) => {
        const crawler = createCrawler();
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
                process.exit(1);
            }
            console.log(
                `\n${pc.green("✓ 로그인 성공! 세션이 저장되었습니다.")}`
            );
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\n${pc.red(`❌ 오류: ${message}`)}`);
            process.exit(1);
        }
    });
