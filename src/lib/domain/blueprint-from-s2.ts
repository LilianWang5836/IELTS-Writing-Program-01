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
      summaryLogicDirection:
        fromLlm.conclusion?.summaryLogicDirection?.trim() ||
        base.conclusion.summaryLogicDirection,
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

  const restateDir = (() => {
    const stance = h?.position?.trim() || s2?.body1Point?.trim() || "";
    return stance
      ? `重申立场：${stance}（Restate position）`
      : "重申立场：再说一次你在引言里给出的 position（Restate position）";
  })();

  const summaryDir = (() => {
    const p1 = s2?.body1Point?.trim();
    const p2 = s2?.body2Point?.trim();
    const a1 = s2?.body1Angle?.trim();
    const a2 = s2?.body2Angle?.trim();
    if (p1 && p2) {
      return `连接两段：用一句话把 Body 1「${p1}」与 Body 2「${p2}」串起来（Link two paragraphs）`;
    }
    if (a1 && a2) {
      return `连接两段：从「${a1}」过渡到「${a2}」，用一句话把两段核心连起来（Link two paragraphs）`;
    }
    return "连接两段：用一句过渡把 Body 1 和 Body 2 的核心串起来（Link two paragraphs）";
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
      summaryLogicDirection: summaryDir,
    },
  };
}
