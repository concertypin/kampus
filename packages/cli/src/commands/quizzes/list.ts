import { Command } from "commander";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";
import {
    cr,
    pad,
    pc,
    separator,
    spinnerStart,
    stripEmoji,
} from "../lib/format.ts";
import { formatQuizStatus } from "../lib/quiz-status.ts";

export const listCommand = new Command("list")
    .description("특정 과목의 퀴즈 목록을 조회합니다")
    .argument("<courseId>", "과목 ID (courses list 명령어로 확인)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus quizzes list 53380")}
`
    )
    .action(async (courseId: string) => {
        const crawler = createCrawler(getLogLevel());
        spinnerStart("퀴즈 목록 불러오는 중...");
        try {
            const quizzes = await crawler.getQuizzes(courseId);
            console.log(
                `${cr}${pc.bold(
                    pc.cyan(
                        stripEmoji(
                            `🧩 퀴즈 목록 - 과목 ${courseId} (${quizzes.length}건)`
                        )
                    )
                )}${pad}`
            );

            if (quizzes.length === 0) {
                console.log(
                    `${cr}${pc.yellow("조회된 퀴즈가 없습니다.")}${pad}`
                );
                return;
            }

            for (const q of quizzes) {
                console.log(separator(40));
                console.log(`${pc.bold("ID")}: ${pc.dim(q.id)}`);
                console.log(`${pc.bold("주차")}: ${q.week}`);
                console.log(`${pc.bold("퀴즈명")}: ${q.name}`);
                if (q.opensAt) {
                    console.log(`${pc.bold("오픈일시")}: ${q.opensAt}`);
                }
                console.log(`${pc.bold("마감일시")}: ${q.closesAt || "-"}`);
                console.log(`${pc.bold("학점")}: ${pc.yellow(q.grade || "-")}`);
                console.log(
                    `${pc.bold("응시 상태")}: ${formatQuizStatus(q.attemptStatus, q.availability)}`
                );
                if (q.availabilityInfo) {
                    console.log(
                        `${pc.bold("이용 제한")}: ${pc.dim(q.availabilityInfo)}`
                    );
                }
            }
            console.log(separator(40));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(
                `${cr}${pc.red(stripEmoji(`❌ 오류: ${message}`))}${pad}`
            );
            process.exitCode = 1;
        }
    });
