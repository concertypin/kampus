import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";

export const readCommand = new Command("read")
    .description("퀴즈 상세 정보를 조회합니다")
    .argument("<quizId>", "퀴즈 ID (quizzes list 명령어로 확인)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus quizzes read 677443")}
`
    )
    .action(async (quizId: string) => {
        const crawler = createCrawler(getLogLevel());
        process.stdout.write(pc.dim("퀴즈 상세 정보 불러오는 중..."));
        try {
            const quiz = await crawler.getQuizDetail(quizId);

            // Clear the loading message
            process.stdout.write(`\r${" ".repeat(40)}\r`);

            console.log(pc.bold(pc.cyan(`🧩 퀴즈 상세 정보`)));
            console.log(pc.dim("─".repeat(50)));

            console.log(`${pc.bold("퀴즈명")}: ${pc.green(quiz.name)}`);
            console.log(`${pc.bold("ID")}: ${pc.dim(quiz.id)}`);

            if (quiz.description) {
                console.log();
                console.log(pc.bold("설명:"));
                console.log(pc.dim(quiz.description));
            }

            console.log();
            console.log(pc.dim("─".repeat(50)));
            console.log(
                `${pc.bold("응시 가능 횟수")}: ${pc.yellow(quiz.attemptsAllowed || "-")}`
            );
            console.log(
                `${pc.bold("오픈 일시")}: ${pc.yellow(quiz.openedAt || "-")}`
            );
            console.log(
                `${pc.bold("마감 일시")}: ${pc.yellow(quiz.closedAt || "-")}`
            );
            console.log(
                `${pc.bold("시간 제한")}: ${pc.yellow(quiz.timeLimit || "-")}`
            );

            const statusLabel = ((): string => {
                switch (quiz.attemptStatus) {
                    case "not_started":
                        return "미응시";
                    case "in_progress":
                        return "진행 중";
                    case "finished":
                        return "응시 완료";
                    default:
                        return "알 수 없음";
                }
            })();
            const statusColor = ((): ((s: string) => string) => {
                switch (quiz.attemptStatus) {
                    case "not_started":
                        return pc.blue;
                    case "in_progress":
                        return pc.yellow;
                    case "finished":
                        return pc.green;
                    default:
                        return pc.dim;
                }
            })();
            console.log(`${pc.bold("응시 상태")}: ${statusColor(statusLabel)}`);
            console.log(pc.dim("─".repeat(50)));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\r${pc.red(`❌ 오류: ${message}`)}`);
            process.exitCode = 1;
        }
    });
