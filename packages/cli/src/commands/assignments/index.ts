import { Command } from "commander";
import { pc } from "../lib/format.ts";
import { listCommand } from "./list.ts";
import { readCommand } from "./read.ts";
import { downloadCommand } from "./download.ts";
import { submitCommand } from "./submit.ts";

export const assignmentsCommand = new Command("assignments")
    .description("과제 관련 명령어")
    .addHelpText(
        "after",
        `
${pc.bold("서브커맨드:")}
  ${pc.green("list <courseId>")}       특정 과목 과제 목록 조회
  ${pc.green("read <assignmentId>")}   과제 상세 정보 조회
  ${pc.green("download <assignmentId>")} 과제 첨부파일 다운로드
  ${pc.green("submit <assignmentId> <filePath>")} 과제 파일 온라인 제출
`
    )
    .addCommand(listCommand)
    .addCommand(readCommand)
    .addCommand(downloadCommand)
    .addCommand(submitCommand);
