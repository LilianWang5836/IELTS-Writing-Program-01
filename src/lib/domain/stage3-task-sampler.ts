import { getCurrentModule } from "./module-compiler";
import type { BodyKey, ModuleId, SessionState } from "./types";

export interface Stage3TaskSample {
  taskType: ModuleId | null;
  body: BodyKey;
}

/** 从 session 直接解析当前 module（判定层统一入口，避免 null 掉进 fallback）。 */
export function resolveStage3Module(state: SessionState): ModuleId | null {
  const s3 = state.s3;
  if (!s3) return null;
  return getCurrentModule(s3.modulePlan, s3.currentBody, s3.moduleIndex);
}

/**
 * Stage3 仅负责“当前练什么（task sampler）”
 * 不参与修复优先级和策略判断。
 */
export function sampleStage3Task(state: SessionState): Stage3TaskSample | null {
  const s3 = state.s3;
  if (!s3) return null;
  const taskType = resolveStage3Module(state);
  return {
    taskType: taskType ?? null,
    body: s3.currentBody,
  };
}
