import { Command } from "commander";
import pc from "picocolors";
import { loginCommand } from "./commands/login.ts";
import { readCommand } from "./commands/read/index.ts";

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
    .addHelpText(
        "after",
        `
${pc.bold("사용 예시:")}
  ${pc.green("kampus login <학번> <비밀번호>")}         로그인 후 세션 저장
  ${pc.green("kampus read courses")}                   수강 과목 목록 조회
  ${pc.green("kampus read attendance <courseId>")}     특정 과목 출석 조회
  ${pc.green("kampus read assignments <courseId>")}    특정 과목 과제 목록 조회
  ${pc.green("kampus read quizzes <courseId>")}        특정 과목 퀴즈 목록 조회
  ${pc.green("kampus read messages")}                  교수님 메시지 조회
`
    );

program.addCommand(loginCommand);
program.addCommand(readCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`오류: ${message}`));
    process.exit(1);
});
