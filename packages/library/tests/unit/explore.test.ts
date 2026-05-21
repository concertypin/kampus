/* eslint-disable no-console */
import { describe, expect, it } from "vitest";
import { fetchWithBase } from "@/client";
import fs from "node:fs";

describe.skip("Explore e-campus details", () => {
    const cookie = "MoodleSession=s1u7hjut3n4l286foc6rnrckv7";

    it("should fetch course page HTML and save it", async () => {
        const response = await fetchWithBase("/course/view.php?id=49341", {
            headers: {
                Cookie: cookie,
            },
        });

        expect(response.status).toBe(200);
        console.log("Course Status:", response.status);
        const html = await response.text();
        fs.writeFileSync("course_49341.html", html, "utf-8");
        console.log("Saved course_49341.html");
    });

    it("should fetch assign and quiz index pages and save them", async () => {
        // Fetch assignments for 49341
        const assignResponse = await fetchWithBase(
            "/mod/assign/index.php?id=49341",
            {
                headers: {
                    Cookie: cookie,
                },
            }
        );
        expect(assignResponse.status).toBe(200);
        console.log("Assign Index Status:", assignResponse.status);
        const assignHtml = await assignResponse.text();
        fs.writeFileSync("assign_index_49341.html", assignHtml, "utf-8");
        console.log("Saved assign_index_49341.html");

        // Fetch quizzes for 50541
        const quizResponse = await fetchWithBase(
            "/mod/quiz/index.php?id=50541",
            {
                headers: {
                    Cookie: cookie,
                },
            }
        );
        expect(quizResponse.status).toBe(200);
        console.log("Quiz Index Status:", quizResponse.status);
        const quizHtml = await quizResponse.text();
        fs.writeFileSync("quiz_index_50541.html", quizHtml, "utf-8");
        console.log("Saved quiz_index_50541.html");
    });
});
