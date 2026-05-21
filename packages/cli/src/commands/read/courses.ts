import { Command } from "commander";
import pc from "picocolors";
import { createCrawler } from "../../crawler.ts";
import { getLogLevel } from "../../index.ts";

export const coursesCommand = new Command("courses")
    .description("수강 중인 과목 목록을 조회합니다")
    .option("--type <type>", "과목 유형 필터 (regular | non-curriculum)")
    .addHelpText(
        "after",
        `
${pc.bold("예시:")}
  ${pc.green("kampus read courses")}
  ${pc.green("kampus read courses --type regular")}
`
    )
    .action(async (opts: { type?: string }) => {
        const crawler = createCrawler(getLogLevel());
        const type =
            opts.type === "regular" || opts.type === "non-curriculum"
                ? opts.type
                : undefined;

        process.stdout.write(pc.dim("과목 목록 불러오는 중..."));
        try {
            const courses = await crawler.getCourses(type);
            console.log(
                `\r${pc.bold(
                    pc.cyan(`📚 수강 과목 목록 (${courses.length}개)`)
                )}          `
            );

            if (courses.length === 0) {
                console.log(pc.yellow("조회된 과목이 없습니다."));
                return;
            }

            for (const course of courses) {
                const typeLabel = course.type === "regular" ? "일반" : "비교과";
                console.log(pc.dim("─".repeat(40)));
                console.log(`${pc.bold("과목명")}: ${course.name}`);
                console.log(`${pc.bold("ID")}: ${course.id}`);
                console.log(`${pc.bold("유형")}: ${typeLabel}`);
            }
            console.log(pc.dim("─".repeat(40)));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\r${pc.red(`❌ 오류: ${message}`)}`);
            process.exitCode = 1;
        }
    });
