import { Command } from "commander";
import pc from "picocolors";
import { type LogLevel } from "@concertypin/ecampus-crawler";
import { authCommand } from "./commands/auth/index.ts";
import { coursesCommand } from "./commands/courses/index.ts";
import { attendanceCommand } from "./commands/attendance/index.ts";
import { assignmentsCommand } from "./commands/assignments/index.ts";
import { quizzesCommand } from "./commands/quizzes/index.ts";
import { messagesCommand } from "./commands/messages/index.ts";

const program = new Command();

program
    .name("kampus")
    .description(
        `${pc.bold(pc.cyan("e-campus CLI"))}\n${pc.dim(
            "강남대학교 e-campus 과제/출석/메시지 조회 도구"
        )}`
    )
    .version("0.0.0", "-v, --version", "버전 정보 출력")
    .helpOption("-h, --help", "도움말 출력")
    .option("--verbose", "info 레벨 로깅 활성화")
    .option("--debug", "debug 레벨 로깅 활성화")
    .option("--trace", "trace 레벨 로깅 활성화 (fetch 상세 포함)")
    .addHelpText(
        "after",
        `
${pc.bold("사용 예시:")}
  ${pc.green("kampus auth login [학번]")}               로그인 후 세션 저장
  ${pc.green("kampus auth check")}                      세션 유효성 확인
  ${pc.green("kampus auth logout")}                     세션 삭제
  ${pc.green("kampus courses list")}                    수강 과목 목록 조회
  ${pc.green("kampus attendance list <courseId>")}      특정 과목 출석 조회
  ${pc.green("kampus assignments list <courseId>")}     특정 과목 과제 목록 조회
  ${pc.green("kampus quizzes list <courseId>")}         특정 과목 퀴즈 목록 조회
  ${pc.green("kampus messages list")}                   교수님 메시지 조회

${pc.bold("로깅 옵션:")}
  ${pc.green("--verbose")}    info 레벨 (일반 정보)
  ${pc.green("--debug")}      debug 레벨 (상세 정보)
  ${pc.green("--trace")}      trace 레벨 (fetch 상세 포함)
`
    );

program.addCommand(authCommand);
program.addCommand(coursesCommand);
program.addCommand(attendanceCommand);
program.addCommand(assignmentsCommand);
program.addCommand(quizzesCommand);
program.addCommand(messagesCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`오류: ${message}`));
    process.exitCode = 1;
});

/**
 * Get the log level from global CLI options
 */
export function getLogLevel(): LogLevel | undefined {
    const opts = program.opts();
    if (opts.trace) return "trace";
    if (opts.debug) return "debug";
    if (opts.verbose) return "info";
    return undefined;
}
