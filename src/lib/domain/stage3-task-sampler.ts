import { getCurrentModule } from "./module-compiler";
import type { BodyKey, ModuleId, SessionState } from "./types";

export interface Stage3TaskSample {
  taskType: ModuleId | null;
  body: BodyKey;
}

/**
 * Stage3 仅负责“当前练什么（task sampler）”
 * 不参与修复优先级和策略判断。
 */
export function sampleStage3Task(state: SessionState): Stage3TaskSample | null {
  const s3 = state.s3;
  if (!s3) return null;
  const taskType = getCurrentModule(s3.modulePlan, s3.currentBody, s3.moduleIndex);
  return {
    taskType: taskType ?? null,
    body: s3.currentBody,
  };
}
