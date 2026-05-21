import { anglesTooSimilar } from "./handoff";
import type { ParagraphSlots, SessionState, Stage1Handoff } from "./types";

export interface RuleHints {
  warnings: string[];
  blockAdvance: boolean;
}

/** P3：提交定稿前的规则提示 */
export function ruleHintsForHandoff(h: Stage1Handoff): RuleHints {
  const warnings: string[] = [];
  let blockAdvance = false;

  if (h.body1Angle && h.body2Angle && anglesTooSimilar(h.body1Angle, h.body2Angle)) {
    warnings.push("Body1 与 Body2 的角度标签过于相似。");
    blockAdvance = true;
  }

  const p1 = h.body1Point.trim();
  const p2 = h.body2Point.trim();
  if (p1 && p2 && p1.length > 6 && p2.length > 6) {
    const a = p1.toLowerCase();
    const b = p2.toLowerCase();
    if (a === b || a.includes(b) || b.includes(a)) {
      warnings.push("两个分论点文本高度重复。");
      blockAdvance = true;
    }
  }

  return { warnings, blockAdvance };
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

/** 论点与 reason 是否疑似复读 */
export function claimReasonRedundant(
  slots?: ParagraphSlots,
): boolean {
  if (!slots?.claim?.trim() || !slots?.reason?.trim()) return false;
  const c = norm(slots.claim);
  const r = norm(slots.reason);
  if (c === r) return true;
  if (c.length > 10 && r.length > 10 && (c.includes(r) || r.includes(c))) return true;
  return false;
}

/** 段论证过短 */
export function bodyDraftTooShort(draft: string): boolean {
  const t = draft.trim();
  return t.length > 0 && t.length < 25;
}

/** 喂给 LLM 的 hints 行 */
export function buildRuleHintsBlock(state: SessionState): string {
  const lines: string[] = [];

  if (state.subStep === "S1_EVAL" && !state.handoffLocked) {
    if (state.coachContext?.handoffPhase === "proposed") {
      lines.push(
        "规则提示：已输出整理提案，引导学生点左侧「确认整理并填入」，勿再列 6 栏清单。",
      );
    } else if (state.coachContext?.angleTeachDone) {
      lines.push(
        "规则提示：已在聊天教过切入面；若学生已答范围词，可写入 proposedHandoff 的 body1Angle/body2Angle。",
      );
    } else {
      lines.push(
        "规则提示：仅当就业侧与学术侧各有足够具体内容时才 essaySubstanceSufficient；首轮勿收口。若学生问切入面/角度，先用「讨论范围/视角」解释。两侧已齐时勿问开放/批判性/教学方法类发散题，应整理 proposedHandoff。",
      );
    }
  }
  if (state.subStep === "S2_2_BODY1" || state.subStep === "S2_3_BODY2") {
    const seg =
      state.subStep === "S2_2_BODY1" ? state.s2?.body1 : state.s2?.body2;
    if (seg?.chainPhase === "proposed") {
      lines.push(
        "规则提示：已输出链条提案，引导学生点左侧「确认链条并填入」；禁止 verdict pass。",
      );
    } else {
      lines.push(
        "规则提示：单源 TurnDecision——以当前缺环为锚，一轮只写主槽；词规则仅守门。禁止 mirror 肯定后重复同一环长模板。",
      );
      lines.push(
        "规则提示：按 Claim→Reason→Example→Link 推进；Link 须有就业/求职结果；advance 永远 false。",
      );
      if (state.coachContext?.chainBuildStep) {
        lines.push(
          `规则提示：当前搭链环节：${state.coachContext.chainBuildStep}。`,
        );
      }
    }
    if (seg?.draft && bodyDraftTooShort(seg.draft)) {
      lines.push("规则提示：本段输入过短，尚不足以评估整体论证。");
    }
    const slots = seg?.slots ?? seg?.chainProposal?.slots;
    if (claimReasonRedundant(slots)) {
      lines.push("规则提示：论点与「原因」表述可能同义重复。");
    }
  }
  if (state.subStep === "S3_2_MODULE") {
    lines.push(
      "规则提示：Sentence Coaching——一次只修一个结构问题；反馈用中文修复问句；禁止 grammar issue/awkward 笼统评语。",
    );
    lines.push(
      "规则提示：你是写作教练不是改写器；优先复用学生原词与原逻辑，先做最小必要结构修复。",
    );
    lines.push(
      "规则提示：assign 给 scaffolding 不给完整句；pass 后等用户点「确认写入」；未通过用 coach 进入修改再检。",
    );
    lines.push(
      "规则提示：Stage3 仅负责 task 采样（claim/reason/example）；修复优先级由 Orchestrator 决定。",
    );
    if (state.s3?.mode === "coach") {
      lines.push("规则提示：用户在修改本句，仅 re-check 当前句，勿推进下一 module。");
    }
    if (state.s3?.orchestrator) {
      lines.push(
        `规则提示：Orchestrator(${state.s3.orchestrator.mode}) 当前焦点=${state.s3.orchestrator.focusLayer}，原因=${state.s3.orchestrator.reason}。`,
      );
    }
  }
  if (state.handoffLocked && state.s2) {
    if (
      state.s2.body1Angle &&
      state.s2.body2Angle &&
      anglesTooSimilar(state.s2.body1Angle, state.s2.body2Angle)
    ) {
      lines.push("规则提示：审题定稿中两角度仍相近，写 Body2 时请注意区分。");
    }
  }
  return lines.length ? lines.join("\n") : "";
}
