export {
    Crawler,
    type CrawlerOptions,
    type Course,
    type AttendanceItem,
    type MessageItem,
    type AssignmentItem,
    type AssignmentDetail,
    type AssignmentFile,
    type QuizItem,
    type QuizDetail,
    type ActivityItem,
    type WeeklyActivity,
    type ResourceItem,
    type ResourceDetail,
    type ResourceFile,
    type SyllabusParams,
    type SyllabusWeeklyPlan,
    type SyllabusInfo,
} from "./crawler";

export { type SessionStorage } from "./storage/storage";
export { MemoryStorage } from "./storage/memory";
export { FileStorage } from "./storage/file";
export { login } from "./auth";
export { fetchWithBase } from "./client";
export {
    type LogLevel,
    setLogLevel,
    getLogger,
    createTaggedLogger,
} from "./logger";
export { AuthError } from "./errors";
