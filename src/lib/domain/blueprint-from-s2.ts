import type { Blueprint, BlueprintBody, SessionState } from "./types";

function mergeBodyBlueprint(
  base: BlueprintBody,
  partial?: Partial<BlueprintBody>,
): BlueprintBody {
  if (!partial) return base;
  const flow = partial.logicFlow;
  return {
    coreIdea: partial.coreIdea?.trim() || base.coreIdea,
    logicFlow: {
      claimDirection:
        flow?.claimDirection?.trim() || base.logicFlow.claimDirection,
      reasonDirection:
        flow?.reasonDirection?.trim() || base.logicFlow.reasonDirection,
      supportDirection:
        flow?.supportDirection?.trim() || base.logicFlow.supportDirection,
    },
  };
}

/** 合并 LLM 骨架与 Stage2 定稿，保证 logicFlow 始终存在 */
export function normalizeBlueprint(
  state: SessionState,
  fromLlm?: Blueprint,
): Blueprint {
  const base = buildBlueprintFromStage2(state);
  if (!fromLlm) return base;
  return {
    body1: mergeBodyBlueprint(base.body1, fromLlm.body1),
    body2: mergeBodyBlueprint(base.body2, fromLlm.body2),
    conclusion: {
      restateDirection:
        fromLlm.conclusion?.restateDirection?.trim() ||
        base.conclusion.restateDirection,
    },
  };
}

/** Stage 2 定稿链条 → Stage 3 轻量 Blueprint（P2） */
export function buildBlueprintFromStage2(state: SessionState): Blueprint {
  const h = state.handoff;
  const s2 = state.s2;
  const b1Slots = s2?.body1?.slots ?? s2?.body1Logic?.slots;
  const b2Slots = s2?.body2?.slots ?? s2?.body2Logic?.slots;

  // moduleDir 统一格式：「中文目标内容（英文任务标签）」
  // ——目标内容直接来自 stage2 的中文 slot，让学生看到这一句具体要表达什么；
  //   英文标签留作模块身份标识，便于教练 LLM 识别功能层。
  const dir = (
    point: string,
    slots?: {
      reason?: string | null;
      example?: string | null;
      elaboration?: string | null;
    },
  ) => ({
    claimDirection: point
      ? `表达本段立场：${point}（Express the claim）`
      : "表达本段立场（Express the claim）",
    reasonDirection: slots?.reason
      ? `给出原因：${slots.reason}（Explain why）`
      : slots?.elaboration
        ? `展开机制：${slots.elaboration}（Develop mechanism）`
        : "解释为什么这个立场成立（Explain why）",
    supportDirection: slots?.example
      ? `给出具体例子或数据：${slots.example}（Give concrete support）`
      : "用一个具体例子或数据支持你的论证（Give concrete support）",
  });

  // Conclusion 段已简化为只做"重申立场"。优先级：
  //   1) Stage 2 用户专门写的 conclusionPoint（最贴目标内容）
  //   2) Stage 1 handoff 的 position（早期立场）
  //   3) body1Point fallback（万一 stage 1 漏填）
  const restateDir = (() => {
    const conclusionPoint = s2?.conclusionPoint?.trim();
    const stance =
      conclusionPoint || h?.position?.trim() || s2?.body1Point?.trim() || "";
    return stance
      ? `重申立场：${stance}（Restate position）`
      : "重申立场：再说一次你在引言里给出的立场（Restate position）";
  })();

  return {
    body1: {
      coreIdea: s2?.body1Point ?? h?.body1Point ?? "body1",
      logicFlow: dir(s2?.body1Point ?? "", b1Slots ?? undefined),
    },
    body2: {
      coreIdea: s2?.body2Point ?? h?.body2Point ?? "body2",
      logicFlow: dir(s2?.body2Point ?? "", b2Slots ?? undefined),
    },
    conclusion: {
      restateDirection: restateDir,
    },
  };
}
