import { Command } from "commander";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../log-level.ts";
import {
    cr,
    errorText,
    pad,
    pc,
    plainText,
    separator,
    spinnerStart,
    stripEmoji,
} from "../lib/format.ts";

/**
 * "N주차 (title)", or just "N주차" when the section title is empty or "-"
 * (a placeholder some courses leave in unused weeks).
 */
function formatWeek(week: number, weekTitle: string): string {
    const title = plainText(weekTitle).trim();
    return title && title !== "-" ? `${week}주차 (${title})` : `${week}주차`;
}

export const listCommand = new Command("list")
    .description("특정 과목의 VOD 강의 목록과 출석/학습 인정기간을 조회합니다")
    .argument("<courseId>", "과목 ID (courses list 명령어로 확인)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus vod list <courseId>")}
`
    )
    .action(async (courseId: string) => {
        const crawler = createCrawler(getLogLevel());
        spinnerStart("VOD 목록 불러오는 중...");
        try {
            const vods = await crawler.getVods(courseId);
            console.log(
                `${cr}${pc.bold(
                    pc.cyan(
                        stripEmoji(
                            `📹 VOD 목록 - 과목 ${courseId} (${vods.length}건)`
                        )
                    )
                )}${pad}`
            );

            if (vods.length === 0) {
                console.log(
                    `${cr}${pc.yellow("조회된 VOD 강의가 없습니다.")}${pad}`
                );
                return;
            }

            for (const v of vods) {
                let statusStr = plainText(v.status);
                if (v.status === "O") {
                    statusStr = pc.green("O (출석)");
                } else if (v.status === "X") {
                    statusStr = pc.red("X (결석/미달)");
                } else if (v.status === "△") {
                    statusStr = pc.yellow("△ (지각)");
                } else {
                    statusStr = pc.dim(plainText(v.status) || "-");
                }

                console.log(separator(40));
                console.log(
                    `${pc.bold("주차")}: ${formatWeek(v.week, v.weekTitle)}`
                );
                console.log(`${pc.bold("강의명")}: ${plainText(v.name)}`);
                console.log(`${pc.bold("ID")}: ${pc.dim(plainText(v.id))}`);
                if (v.duration) {
                    console.log(
                        `${pc.bold("영상 길이")}: ${plainText(v.duration)}`
                    );
                }
                if (v.period) {
                    console.log(
                        `${pc.bold("학습 인정기간")}: ${plainText(v.period)}`
                    );
                }
                if (v.latePeriod) {
                    console.log(
                        `${pc.bold("지각 인정기한")}: ${pc.yellow(plainText(v.latePeriod))}`
                    );
                }
                console.log(`${pc.bold("출석 상태")}: ${statusStr}`);
                if (v.watchedTime || v.requiredTime) {
                    const reqStr = v.requiredTime
                        ? ` (인정 기준: ${plainText(v.requiredTime)})`
                        : "";
                    console.log(
                        `${pc.bold("시청 시간")}: ${plainText(v.watchedTime)}${reqStr}`
                    );
                }
            }
            console.log(separator(40));
        } catch (err: unknown) {
            const message = errorText(err);
            console.error(
                `${cr}${pc.red(stripEmoji(`❌ 오류: ${message}`))}${pad}`
            );
            process.exitCode = 1;
        }
    });
