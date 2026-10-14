import type { ResourceType } from "@concertypin/ecampus-crawler";

const RESOURCE_TYPE_NAMES: Record<ResourceType, string> = {
    ubfile: "파일",
    resource: "파일",
    folder: "폴더",
    url: "링크",
    page: "페이지",
};

/**
 * Display label for a resource type: a Korean name followed by the module
 * type itself, which is the value `resources download --type` expects.
 */
export function resourceTypeLabel(type: ResourceType): string {
    return `${RESOURCE_TYPE_NAMES[type]} (${type})`;
}
