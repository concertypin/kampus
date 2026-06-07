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

export const listCommand = new Command("list")
    .description("특정 과목의 과제 목록을 조회합니다")
    .argument("<courseId>", "과목 ID (courses list 명령어로 확인)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus assignments list 49341")}
`
    )
    .action(async (courseId: string) => {
        const crawler = createCrawler(getLogLevel());
        spinnerStart("과제 목록 불러오는 중...");
        try {
            const assignments = await crawler.getAssignments(courseId);
            console.log(
                `${cr}${pc.bold(
                    pc.cyan(
                        stripEmoji(
                            `📝 과제 목록 - 과목 ${courseId} (${assignments.length}건)`
                        )
                    )
                )}${pad}`
            );

            if (assignments.length === 0) {
                console.log(
                    `${cr}${pc.yellow("조회된 과제가 없습니다.")}${pad}`
                );
                return;
            }

            for (const a of assignments) {
                const submitted =
                    a.submissionStatus.toLowerCase().includes("제출") ||
                    a.submissionStatus.toLowerCase().includes("submitted");
                const statusStr = submitted
                    ? pc.green(a.submissionStatus)
                    : pc.red(a.submissionStatus);
                console.log(separator(40));
                console.log(`${pc.bold("주차")}: ${a.week}`);
                console.log(`${pc.bold("과제명")}: ${a.name}`);
                console.log(`${pc.bold("ID")}: ${pc.dim(a.id)}`);
                console.log(`${pc.bold("마감일시")}: ${a.dueDate}`);
                console.log(`${pc.bold("제출 상태")}: ${statusStr}`);
                console.log(`${pc.bold("학점")}: ${pc.yellow(a.grade)}`);
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
