import { describe, expect, it, vi } from "vitest";
import { Crawler } from "@/crawler";
import * as fs from "node:fs/promises";
import * as path from "node:path";

describe("Crawler HTML Parsing Integration Tests (Mocked Fetch)", () => {
    // Helper to read local HTML snapshot
    async function readSnapshot(filename: string): Promise<string> {
        const filePath = path.join(process.cwd(), filename);
        return fs.readFile(filePath, "utf-8");
    }

    it("should parse courses from dashboard.html correctly", async () => {
        const html = await readSnapshot("dashboard.html");
        const crawler = new Crawler();

        vi.spyOn(crawler, "fetch").mockResolvedValue(
            new Response(html, { status: 200 })
        );

        const courses = await crawler.getCourses();

        // Check regular and non-curriculum counts
        expect(courses.length).toBe(19);

        const regularCourses = courses.filter((c) => c.type === "regular");
        const nonCurriculum = courses.filter(
            (c) => c.type === "non-curriculum"
        );

        expect(regularCourses.length).toBe(8);
        expect(nonCurriculum.length).toBe(11);

        // Verify some specific course details
        const javaCourse = courses.find((c) => c.id === "49353");
        expect(javaCourse).toBeDefined();
        expect(javaCourse?.name).toBe(
            "Java Programming[01] ( 월 13:40-17:20 )"
        );
        expect(javaCourse?.type).toBe("regular");

        const smartPhoneCourse = courses.find((c) => c.id === "50906");
        expect(smartPhoneCourse).toBeDefined();
        expect(smartPhoneCourse?.name).toBe(
            "2026-1 대학생 스마트폰 과의존 예방교육"
        );
        expect(smartPhoneCourse?.type).toBe("non-curriculum");
    });

    it("should parse attendance progress from attendance_50541.html with rowspan handling", async () => {
        const html = await readSnapshot("attendance_50541.html");
        const crawler = new Crawler();

        vi.spyOn(crawler, "fetch").mockResolvedValue(
            new Response(html, { status: 200 })
        );

        const attendance = await crawler.getAttendance("50541");

        // Verify length of attendance items
        expect(attendance.length).toBeGreaterThan(0);

        // Week 1 should have status and correct week status mapped
        const firstItem = attendance[0]!;
        expect(firstItem.week).toBe(1);
        expect(firstItem.title).toContain("2026-1학기 온라인 채플 1회차");
        expect(firstItem.status).toBe("O");
        expect(firstItem.weekStatus).toBe("O");

        // Week 3 should be 온라인 채플 2회차
        const thirdItem = attendance[2]!;
        expect(thirdItem.week).toBe(3);
        expect(thirdItem.title).toContain("2026-1학기 온라인 채플 2회차");
        expect(thirdItem.status).toBe("O");
    });

    it("should parse assignments from assign_index_49341.html", async () => {
        const html = await readSnapshot("assign_index_49341.html");
        const crawler = new Crawler();

        vi.spyOn(crawler, "fetch").mockResolvedValue(
            new Response(html, { status: 200 })
        );

        const assignments = await crawler.getAssignments("49341");

        expect(assignments.length).toBe(2);

        const firstAssign = assignments[0]!;
        expect(firstAssign.week).toBe("11주차");
        expect(firstAssign.name).toBe("11주차 활동보고서");
        expect(firstAssign.dueDate).toBe("2026-05-20 00:00");
        expect(firstAssign.submissionStatus).toBe("No submission");
        expect(firstAssign.grade).toBe("-");
    });

    it("should parse quizzes from quiz_index_50541.html", async () => {
        const html = await readSnapshot("quiz_index_50541.html");
        const crawler = new Crawler();

        vi.spyOn(crawler, "fetch").mockResolvedValue(
            new Response(html, { status: 200 })
        );

        const quizzes = await crawler.getQuizzes("50541");

        expect(quizzes.length).toBe(1);

        const firstQuiz = quizzes[0]!;
        expect(firstQuiz.week).toBe(
            "6회차 (05.19(화) 9시 ~ 05.25(월) 23시 55분)"
        );
        expect(firstQuiz.name).toBe("퀴즈_6차");
        expect(firstQuiz.closesAt).toBe("2026-05-25 23:55");
        expect(firstQuiz.grade).toBe("");
    });

    it("should parse messages from message.html", async () => {
        const html = await readSnapshot("message.html");
        const crawler = new Crawler();

        vi.spyOn(crawler, "fetch").mockResolvedValue(
            new Response(html, { status: 200 })
        );

        const messages = await crawler.getMessages(1);

        expect(messages.length).toBe(15);

        const chapelMsg = messages.find(
            (m) => m.senderId === "99671" && m.time === "2026-05-05 17:36"
        );
        expect(chapelMsg).toBeDefined();
        expect(chapelMsg?.senderName).toBe("SON HYEMIN");
        expect(chapelMsg?.isNew).toBe(true);
        expect(chapelMsg?.content).toContain("5회차 채플이");
    });

    it("should parse weekly activities from course_49341.html", async () => {
        const html = await readSnapshot("course_49341.html");
        const crawler = new Crawler();

        vi.spyOn(crawler, "fetch").mockResolvedValue(
            new Response(html, { status: 200 })
        );

        const weekly = await crawler.getWeeklyActivities("49341");

        expect(weekly.length).toBeGreaterThan(0);

        // Find Week 11 (section-11)
        const week11 = weekly.find((w) => w.weekId === "section-11");
        expect(week11).toBeDefined();
        expect(week11?.weekTitle).toContain("11주차");

        // Verify activities in week 11
        const activities = week11?.activities || [];
        expect(activities.length).toBeGreaterThan(0);

        const assignAct = activities.find((a) => a.type === "assign");
        expect(assignAct).toBeDefined();
        expect(assignAct?.name).toContain("11주차 활동보고서");
        expect(assignAct?.url).toContain("mod/assign/view.php");

        // Find Week 1 (section-1)
        const week1 = weekly.find((w) => w.weekId === "section-1");
        expect(week1).toBeDefined();
        const fileAct = week1?.activities.find((a) => a.type === "ubfile");
        expect(fileAct).toBeDefined();
        expect(fileAct?.name).toContain("강의자료");
    });
});
