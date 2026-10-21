import { Command } from "commander";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";
import { cr, pc, separator, stripEmoji } from "../lib/format.ts";
import { spinner } from "../lib/cli-utils.ts";
import { formatQuizStatus } from "../lib/quiz-status.ts";

export const readCommand = new Command("read")
    .description("퀴즈 상세 정보를 조회합니다")
    .argument("<quizId>", "퀴즈 ID (quizzes list 명령어로 확인)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus quizzes read <quizId>")}
`
    )
    .action(async (quizId: string) => {
        const crawler = createCrawler(getLogLevel());
        using spin = spinner("퀴즈 상세 정보 불러오는 중...");
        try {
            const quiz = await crawler.getQuizDetail(quizId);

            // Clear the loading spinner before printing results
            spin.stop();

            console.log(pc.bold(pc.cyan(stripEmoji(`🧩 퀴즈 상세 정보`))));
            console.log(separator(50));

            console.log(`${pc.bold("퀴즈명")}: ${pc.green(quiz.name)}`);
            console.log(`${pc.bold("ID")}: ${pc.dim(quiz.id)}`);

            if (quiz.description) {
                console.log();
                console.log(pc.bold("설명:"));
                console.log(pc.dim(quiz.description));
            }

            console.log();
            console.log(separator(50));
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

            console.log(
                `${pc.bold("응시 상태")}: ${formatQuizStatus(quiz.attemptStatus, quiz.availability)}`
            );
            if (quiz.availabilityInfo) {
                console.log(
                    `${pc.bold("이용 제한")}: ${pc.dim(quiz.availabilityInfo)}`
                );
            }
            console.log(separator(50));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`${cr}${pc.red(stripEmoji(`❌ 오류: ${message}`))}`);
            process.exitCode = 1;
        }
    });
