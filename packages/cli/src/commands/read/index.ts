import { Command } from "commander";
import pc from "picocolors";
import { coursesCommand } from "./courses.ts";
import { attendanceCommand } from "./attendance.ts";
import { assignmentsCommand } from "./assignments.ts";
import { quizzesCommand } from "./quizzes.ts";
import { messagesCommand } from "./messages.ts";

export const readCommand = new Command("read")
    .description("e-campus 학사 정보를 조회합니다")
    .addHelpText(
        "after",
        `
${pc.bold("서브커맨드:")}
  ${pc.green("courses")}                수강 과목 목록
  ${pc.green("attendance <courseId>")}  특정 과목 출석 현황
  ${pc.green("assignments <courseId>")} 특정 과목 과제 목록
  ${pc.green("quizzes <courseId>")}     특정 과목 퀴즈 목록
  ${pc.green("messages")}              교수님 메시지 목록
`
    )
    .addCommand(coursesCommand)
    .addCommand(attendanceCommand)
    .addCommand(assignmentsCommand)
    .addCommand(quizzesCommand)
    .addCommand(messagesCommand);
