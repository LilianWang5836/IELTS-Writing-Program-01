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
    const userTurns = state.chatHistory.filter((m) => m.role === "user").length;
    if (userTurns >= 4) {
      lines.push("规则提示：探索轮次已多，应引导左侧定稿提交，勿再追问双方观点含义。");
    }
    if (state.coachContext?.readyForHandoff) {
      lines.push("规则提示：已达探索完成度，本轮引导填写左侧审题定稿。");
    } else if (userTurns === 1) {
      lines.push(
        "规则提示：首轮勿说「探索够了」；可肯定并允许再补一句，或提示可填定稿。",
      );
    }
  }
  if (state.subStep === "S2_2_BODY1" || state.subStep === "S2_3_BODY2") {
    const seg =
      state.subStep === "S2_2_BODY1" ? state.s2?.body1 : state.s2?.body2;
    if (seg?.draft && bodyDraftTooShort(seg.draft)) {
      lines.push("规则提示：本段输入过短，尚不足以评估整体论证。");
    }
    const slots = seg?.slots;
    if (claimReasonRedundant(slots)) {
      lines.push("规则提示：论点与「原因」表述可能同义重复。");
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
