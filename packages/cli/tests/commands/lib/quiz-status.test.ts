import { describe, expect, it } from "vitest";
import { quizStatusLabel } from "@/commands/lib/quiz-status";

describe("quizStatusLabel", () => {
    it("labels an unavailable quiz by the reason it is unavailable", () => {
        expect(quizStatusLabel("unavailable", "closed")).toBe(
            "확인 불가 (이용 기간 종료)"
        );
        expect(quizStatusLabel("unavailable", "not_yet_open")).toBe(
            "확인 불가 (아직 열리지 않음)"
        );
        expect(quizStatusLabel("unavailable", "restricted")).toBe(
            "확인 불가 (이용 조건 미충족)"
        );
    });

    it.each(["not_yet_open", "restricted"] as const)(
        "does not call a %s quiz closed",
        (availability) => {
            expect(quizStatusLabel("unavailable", availability)).not.toContain(
                "종료"
            );
        }
    );

    it("does not claim a reason when none is known", () => {
        expect(quizStatusLabel("unavailable")).toBe("확인 불가 (이용 불가)");
    });

    it("ignores availability for a quiz whose attempt state was read", () => {
        expect(quizStatusLabel("finished", "available")).toBe("응시 완료");
        expect(quizStatusLabel("not_started", "available")).toBe("미응시");
    });
});
