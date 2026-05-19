import type { BodyKey, ModuleId, QuestionType } from "./types";

function defaultBodyModules(): ModuleId[] {
  return ["claim", "reason", "example"];
}

export function compileModulePlan(
  questionType: QuestionType,
): Record<BodyKey, ModuleId[]> {
  const body = defaultBodyModules();
  const withImpact: ModuleId[] = [...body, "impact"];

  switch (questionType) {
    case "adv_disadv":
      return {
        body1: withImpact,
        body2: withImpact,
        conclusion: ["conclusion_restate", "conclusion_summary"],
      };
    case "discuss":
      return {
        body1: body,
        body2: body,
        conclusion: ["conclusion_restate", "conclusion_summary", "evaluation"],
      };
    default:
      return {
        body1: body,
        body2: body,
        conclusion: ["conclusion_restate", "conclusion_summary"],
      };
  }
}

export function moduleKey(body: BodyKey, moduleId: ModuleId): string {
  return `${body}.${moduleId}`;
}

export function getCurrentModule(
  plan: Record<BodyKey, ModuleId[]>,
  body: BodyKey,
  index: number,
): ModuleId | null {
  const list = plan[body];
  if (!list || index >= list.length) return null;
  return list[index];
}
