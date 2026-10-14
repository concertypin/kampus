import type {
    QuizAttemptStatus,
    QuizAvailability,
} from "@concertypin/ecampus-crawler";
import { pc } from "./format.ts";

const STATUS_LABELS: Record<QuizAttemptStatus, string> = {
    not_started: "미응시",
    in_progress: "진행 중",
    finished: "응시 완료",
    abandoned: "미제출 (응시 종료)",
    unavailable: "확인 불가 (이용 불가)",
    unknown: "알 수 없음",
};

/**
 * Why the attempt state of an `unavailable` quiz cannot be read. A quiz that
 * has not opened yet, or is locked behind a condition, is not "closed".
 */
const UNAVAILABLE_LABELS: Record<QuizAvailability, string> = {
    available: STATUS_LABELS.unavailable,
    closed: "확인 불가 (이용 기간 종료)",
    not_yet_open: "확인 불가 (아직 열리지 않음)",
    restricted: "확인 불가 (이용 조건 미충족)",
};

const STATUS_COLORS: Record<QuizAttemptStatus, (s: string) => string> = {
    not_started: pc.blue,
    in_progress: pc.yellow,
    finished: pc.green,
    abandoned: pc.red,
    unavailable: pc.dim,
    unknown: pc.dim,
};

/**
 * Korean label for a quiz attempt status, e.g. `응시 완료`.
 * For an `unavailable` quiz the label says why, from its availability.
 */
export function quizStatusLabel(
    status: QuizAttemptStatus,
    availability?: QuizAvailability
): string {
    if (status === "unavailable" && availability) {
        return UNAVAILABLE_LABELS[availability] ?? STATUS_LABELS.unavailable;
    }
    return STATUS_LABELS[status] ?? STATUS_LABELS.unknown;
}

/** Colored Korean label for a quiz attempt status. */
export function formatQuizStatus(
    status: QuizAttemptStatus,
    availability?: QuizAvailability
): string {
    const color = STATUS_COLORS[status] ?? STATUS_COLORS.unknown;
    return color(quizStatusLabel(status, availability));
}
