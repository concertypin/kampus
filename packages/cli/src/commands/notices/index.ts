import { Command } from "commander";
import { pc } from "../lib/format.ts";
import { executeList, listCommand, type ListOptions } from "./list.ts";
import { readCommand } from "./read.ts";

export const noticesCommand = new Command("notices")
    .description("공지사항 관련 명령어")
    .argument("[courseId]", "과목 ID (courses list 명령어로 확인)")
    .option("-p, --page <page>", "페이지 번호 (기본값: 1)")
    .option("-a, --all", "모든 페이지 조회")
    .option("--json", "JSON 형식으로 출력 (자동화용)")
    .addHelpText(
        "after",
        `
${pc.bold("서브커맨드:")}
  ${pc.green("list <courseId>")}            특정 과목 공지사항 목록 조회
  ${pc.green("read <courseId> <postId>")}   공지사항 본문/첨부파일 조회

${pc.bold("예시:")}
  ${pc.green("kampus notices <courseId>")}
  ${pc.green("kampus notices <courseId> --json")}
  ${pc.green("kampus notices list <courseId> --all")}
  ${pc.green("kampus notices read <courseId> <postId>")}
`
    )
    .action(async (courseId: string | undefined, options: ListOptions) => {
        if (courseId) {
            await executeList(courseId, options);
        } else {
            noticesCommand.help();
        }
    })
    .addCommand(listCommand)
    .addCommand(readCommand);
