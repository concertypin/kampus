import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../../crawler.ts";

export const attendanceCommand = new Command("attendance")
    .description("특정 과목의 출석 현황을 조회합니다")
    .argument("<courseId>", "과목 ID (courses 명령어로 확인)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus read attendance 49341")}
`
    )
    .action(async (courseId: string) => {
        const crawler = createCrawler();
        process.stdout.write(pc.dim("출석 정보 불러오는 중..."));
        try {
            const items = await crawler.getAttendance(courseId);
            console.log(
                `\r${pc.bold(
                    pc.cyan(
                        `📋 출석 현황 - 과목 ${courseId} (${items.length}건)`
                    )
                )}          `
            );
            console.log(pc.dim("─".repeat(72)));
            console.log(
                pc.bold(
                    `  ${"주차".padEnd(4)} ${"제목".padEnd(28)} ${"필요시간".padEnd(8)} ${"시청시간".padEnd(8)} ${"상태".padEnd(4)}`
                )
            );
            console.log(pc.dim("─".repeat(72)));

            if (items.length === 0) {
                console.log(pc.yellow("  조회된 항목이 없습니다."));
                return;
            }

            for (const item of items) {
                const statusColor = item.status === "O" ? pc.green : pc.red;
                const title =
                    item.title.length > 26
                        ? `${item.title.slice(0, 25)}…`
                        : item.title;
                console.log(
                    `  ${String(item.week).padEnd(4)} ${title.padEnd(28)} ${item.requiredTime.padEnd(8)} ${item.watchedTime.padEnd(8)} ${statusColor(item.status.padEnd(4))}`
                );
            }
            console.log(pc.dim("─".repeat(72)));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\r${pc.red(`❌ 오류: ${message}`)}`);
            process.exit(1);
        }
    });
