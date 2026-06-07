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
    .description("특정 과목의 강의자료 목록을 조회합니다")
    .argument("<courseId>", "과목 ID (courses list 명령어로 확인)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus resources list 49341")}
`
    )
    .action(async (courseId: string) => {
        const crawler = createCrawler(getLogLevel());
        spinnerStart("강의자료 목록 불러오는 중...");
        try {
            const resources = await crawler.getResources(courseId);
            console.log(
                `${cr}${pc.bold(
                    pc.cyan(
                        stripEmoji(
                            `📚 강의자료 목록 - 과목 ${courseId} (${resources.length}건)`
                        )
                    )
                )}${pad}`
            );

            if (resources.length === 0) {
                console.log(
                    `${cr}${pc.yellow("조회된 강의자료가 없습니다.")}${pad}`
                );
                return;
            }

            for (const r of resources) {
                console.log(separator(40));
                console.log(`${pc.bold("주차")}: ${r.weekTitle}`);
                console.log(`${pc.bold("자료명")}: ${r.name}`);
                console.log(`${pc.bold("ID")}: ${pc.dim(r.id)}`);
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
