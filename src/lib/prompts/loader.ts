import fs from "fs";
import path from "path";
import type { PromptModuleId } from "@/lib/domain/types";

const PROMPT_FILES: Record<Exclude<PromptModuleId, never>, string> = {
  P1: "P1_stage1.txt",
  P1H: "P1H_handoff.txt",
  P2_2: "P2_2_body1.txt",
  P2_3: "P2_3_body2.txt",
  P3_1: "P3_1_blueprint.txt",
  P3_2: "P3_2_module.txt",
  P3_3: "P3_3_body_check.txt",
};

let cache: Map<string, string> | null = null;

function loadFile(name: string): string {
  if (!cache) cache = new Map();
  if (cache.has(name)) return cache.get(name)!;
  const filePath = path.join(process.cwd(), "prompts", name);
  const content = fs.readFileSync(filePath, "utf-8");
  cache.set(name, content);
  return content;
}

/** 流程规划 + 内容回应（用户调优 Prompt 拆解，原文规则在 P0_content 与各 P* 模块） */
export function loadPromptBase(): string {
  return `${loadFile("P0_flow.txt")}\n\n---\n\n${loadFile("P0_content.txt")}`;
}

export function loadPromptModule(id: PromptModuleId): string {
  const task = loadFile(PROMPT_FILES[id]);
  if (id.startsWith("P2_")) {
    return `${loadFile("P2_0_paragraph_frame.txt")}\n\n---\n\n${task}`;
  }
  return task;
}

export function interpolate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function buildFullPrompt(
  moduleId: PromptModuleId,
  vars: Record<string, string>,
  meta: { stageName: string; subStepName: string },
): string {
  const base = interpolate(loadPromptBase(), {
    query: vars.query ?? "",
    active_stage_name: meta.stageName,
    active_substep_name: meta.subStepName,
    state_summary: vars.state_summary ?? "",
  });
  const task = interpolate(loadPromptModule(moduleId), vars);
  return `${base}\n\n---\n\n${task}`;
}
