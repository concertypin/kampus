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
    .description("특정 과목의 출석 현황을 조회합니다")
    .argument("<courseId>", "과목 ID (courses list 명령어로 확인)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus attendance list 49341")}
`
    )
    .action(async (courseId: string) => {
        const crawler = createCrawler(getLogLevel());
        spinnerStart("출석 정보 불러오는 중...");
        try {
            const items = await crawler.getAttendance(courseId);
            console.log(
                `${cr}${pc.bold(
                    pc.cyan(
                        stripEmoji(
                            `📋 출석 현황 - 과목 ${courseId} (${items.length}건)`
                        )
                    )
                )}${pad}`
            );

            if (items.length === 0) {
                console.log(
                    `${cr}${pc.yellow("조회된 항목이 없습니다.")}${pad}`
                );
                return;
            }

            for (const item of items) {
                const statusColor = item.status === "O" ? pc.green : pc.red;
                console.log(separator(40));
                console.log(`${pc.bold("주차")}: ${item.week}`);
                console.log(`${pc.bold("제목")}: ${item.title}`);
                console.log(`${pc.bold("필요시간")}: ${item.requiredTime}`);
                console.log(`${pc.bold("시청시간")}: ${item.watchedTime}`);
                console.log(`${pc.bold("상태")}: ${statusColor(item.status)}`);
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
