import { STAGE1_OPENING, MODULE_LABELS } from "@/lib/domain/constants";
import { applyHandoffToState, validateHandoff } from "@/lib/domain/handoff";
import { sampleStage3Task, resolveStage3Module } from "@/lib/domain/stage3-task-sampler";
import { buildRuleHintsBlock, ruleHintsForHandoff } from "@/lib/domain/rule-hints";
import { resolvePromptModule, stageLabel } from "@/lib/domain/router";
import { normalizeBlueprint } from "@/lib/domain/blueprint-from-s2";
import { migrateSessionState } from "@/lib/domain/migrate-state";
import { applyOrchestratorShadow } from "@/lib/domain/essay-orchestrator";
import { buildStage3OutputContract } from "@/lib/domain/output-contract";
import {
  applyOrchestratorHardGate,
  observeOrchestratorHardGate,
} from "@/lib/domain/orchestrator-gate";
import { appendChat, stateSummary } from "@/lib/domain/state";
import { validateUserSentence } from "@/lib/domain/validate";
import type {
  LlmTurnResult,
  PromptModuleId,
  SessionState,
  Stage1Handoff,
} from "@/lib/domain/types";
import { logicBreakdownFromProposal } from "@/lib/domain/chain-proposal";
import {
  assessEssaySubstance,
  explorationSideStatus,
  isStage1ChainLeakMessage,
  resolveConfirmableHandoffProposal,
  userMessages,
} from "@/lib/domain/essay-substance";
import { assessParagraphSubstance } from "@/lib/domain/paragraph-substance";
import {
  assessExplorationContent,
  isProposalAffirmation,
  postProcessStage1,
} from "@/lib/domain/stage1-coach";
import {
  buildStage1SubmitFeedback,
  enrichHandoffFromChat,
  sanitizeHandoffProposal,
} from "@/lib/domain/essay-substance";
import {
  applyChainProposalToState,
  postProcessStage2,
} from "@/lib/domain/stage2-coach";
import {
  assessMeaningAlignment,
  assessLocalViability,
  buildMetaRecallResponse,
  buildScaffoldResponse,
  classifyViabilityKind,
  detectStage3SentenceIntent,
  diagnoseSentence,
  getModuleDirection,
  looksStructurallyWorkable,
  type LocalViabilityResult,
  type ViabilityIssue,
  type ViabilityIssueKind,
  type ViabilitySeverityClass,
  postProcessStage3Sentence,
} from "@/lib/domain/sentence-coach";
import type { BodyKey, WorkshopBodyKey } from "@/lib/domain/types";
import { formatCoachDisplay } from "@/lib/llm/guard";
import { callLlm, callLlmJson } from "@/lib/llm/client";
import { buildFullPrompt } from "@/lib/prompts/loader";
import { markerWhenAdvance, shouldAdvance } from "./advance";
import {
  afterBodyCheck,
  advanceModuleAfterPass,
  applyBlueprint,
  applyBodyCoachUpdate,
  applyHandoffAdvance,
  applyStage2Body1Advance,
  applyStage2Body2Advance,
  appendMarker,
  bodyTaskAfterBody1,
  bodyTaskAfterHandoff,
  integrateBodySentences,
  markerForSubStep,
  mergeS1FromResult,
} from "./transitions";

export interface TurnResponse {
  replies: string[];
  state: SessionState;
  requiresConfirm: boolean;
  canSubmit: boolean;
}

/**
 * 句子写入条件满足时自动推进：
 * - stabilizable：完全通过，无 correction。
 * - refine_needed：accept-with-correction，原句已写入，coach 上一条消息已贴 correction。
 *
 * 触发后调 advanceModuleAfterPass + 下一句 assign（或 body check）。
 * 用户不再需要点「确认写入」按钮；handleConfirm 保留作兜底入口。
 */
async function autoAdvanceIfPassable(
  state: SessionState,
  replies: string[],
): Promise<SessionState> {
  const passable =
    state.coachContext?.sentenceState === "stabilizable" ||
    state.coachContext?.sentenceState === "refine_needed";
  if (
    state.subStep !== "S3_2_MODULE" ||
    state.s3?.mode !== "feedback" ||
    !state.s3?.pendingSentence ||
    !passable
  ) {
    return state;
  }

  let s = advanceModuleAfterPass(state);

  if (s.subStep === "S3_3_BODY_CHECK") {
    const { reply, state: ns, autoContinue } = await processLlmTurn(s, "P3_3");
    replies.push(reply);
    s = ns;
    if (autoContinue && s.subStep === "S3_2_MODULE") {
      const next = await processLlmTurn(s, "P3_2");
      replies.push(next.reply);
      s = next.state;
    }
  } else if (s.subStep === "S3_2_MODULE") {
    const { reply, state: ns } = await processLlmTurn(s, "P3_2");
    replies.push(reply);
    s = ns;
  }
  return s;
}

function ensureMigrated(state: SessionState): SessionState {
  return migrateSessionState(state);
}

async function runPrompt(
  state: SessionState,
  moduleId: PromptModuleId,
  vars: Record<string, string>,
  userMessage?: string,
): Promise<LlmTurnResult> {
  const prompt = buildFullPrompt(moduleId, { query: state.topic, ...vars }, {
    stageName: stageLabel(state),
    subStepName: state.subStep,
  });
  return callLlm(prompt, moduleId, {
    userMessage,
    subStep: state.subStep,
  });
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** 把本地与 LLM 的 viability 结果合并去重：
 *  - 优先保留本地命中的 issue（中文 anchor + guideZh 已经更精准）
 *  - LLM 仅补充本地未覆盖的 issue（按 anchor/kind 去重）
 *  - 最终 issues 按 hard > soft、severity 降序排列，最多保留 5 条避免噪声。 */
function mergeViability(
  local: LocalViabilityResult,
  llm: LocalViabilityResult,
): LocalViabilityResult {
  const seen = new Set<string>();
  const issues: ViabilityIssue[] = [];
  const key = (i: ViabilityIssue) =>
    `${i.kind}::${(i.anchor ?? "").toLowerCase().slice(0, 40)}`;
  for (const it of local.issues) {
    const k = key(it);
    if (seen.has(k)) continue;
    seen.add(k);
    issues.push({
      ...it,
      severityClass: it.severityClass ?? classifyViabilityKind(it.kind),
    });
  }
  for (const it of llm.issues) {
    const k = key(it);
    if (seen.has(k)) continue;
    seen.add(k);
    issues.push({
      ...it,
      severityClass: it.severityClass ?? classifyViabilityKind(it.kind),
    });
  }
  // 排序：hard 先 + severity 降序
  issues.sort((a, b) => {
    const ca: ViabilitySeverityClass =
      a.severityClass ?? classifyViabilityKind(a.kind);
    const cb: ViabilitySeverityClass =
      b.severityClass ?? classifyViabilityKind(b.kind);
    if (ca !== cb) return ca === "hard" ? -1 : 1;
    return (b.severity ?? 0) - (a.severity ?? 0);
  });
  const truncated = issues.slice(0, 5);
  const penalty = Math.min(
    0.8,
    truncated.reduce((sum, i) => sum + (i.severity ?? 0), 0),
  );
  return {
    score: Math.max(0, 1 - penalty),
    // 本地命中 + LLM 兜底，合并后置信度取两者较高
    confidence: Math.max(local.confidence, llm.confidence),
    issues: truncated,
  };
}

const ALLOWED_VIABILITY_KINDS = new Set<ViabilityIssueKind>([
  "collocation",
  "phrase_naturalness",
  "semantic_plausibility",
  "target_role",
  "grammar_agreement",
  "spelling",
  "tense",
  "article",
  "preposition",
]);

function normalizeViabilityFromLlm(raw: unknown): LocalViabilityResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as {
    score?: unknown;
    confidence?: unknown;
    issues?: unknown;
  };
  const score =
    typeof obj.score === "number" ? clamp01(obj.score) : undefined;
  const confidence =
    typeof obj.confidence === "number" ? clamp01(obj.confidence) : undefined;
  if (typeof score !== "number" || typeof confidence !== "number") return null;

  const issues: ViabilityIssue[] = Array.isArray(obj.issues)
    ? (obj.issues
        .map((it): ViabilityIssue | null => {
          if (!it || typeof it !== "object") return null;
          const i = it as {
            kind?: unknown;
            severity?: unknown;
            severityClass?: unknown;
            note?: unknown;
            anchor?: unknown;
            guideZh?: unknown;
            replacement?: unknown;
          };
          const kind =
            typeof i.kind === "string" &&
            ALLOWED_VIABILITY_KINDS.has(i.kind as ViabilityIssueKind)
              ? (i.kind as ViabilityIssueKind)
              : null;
          const severity =
            typeof i.severity === "number" ? clamp01(i.severity) : 0.3;
          const note = typeof i.note === "string" ? i.note.trim() : "";
          if (!kind || !note) return null;
          const severityClass: ViabilitySeverityClass =
            i.severityClass === "hard" || i.severityClass === "soft"
              ? i.severityClass
              : classifyViabilityKind(kind);
          const anchor = typeof i.anchor === "string" ? i.anchor.trim() : undefined;
          const guideZh = typeof i.guideZh === "string" ? i.guideZh.trim() : undefined;
          // hard 类 LLM 即便返回 replacement，也不直接展示——交给用户自己改。
          const replacement =
            severityClass === "hard"
              ? undefined
              : typeof i.replacement === "string"
                ? i.replacement.trim()
                : undefined;
          return {
            kind,
            severity,
            severityClass,
            note,
            anchor: anchor || undefined,
            guideZh: guideZh || undefined,
            replacement,
          } satisfies ViabilityIssue;
        })
        .filter((it): it is ViabilityIssue => !!it))
    : [];

  // "说不清就视为 OK"：LLM 没列出任何具体 issue 时，把 score/confidence 拉满，
  // 避免它用"低分 + 空 issues"逼出 fallback workable，让用户盲改。
  if (issues.length === 0) {
    return { score: 1, confidence: 0.9, issues: [] };
  }
  return {
    score,
    confidence,
    issues,
  };
}

/**
 * Stage 3 LLM 调试日志：把 prompt / raw / parsed 三段都打到服务端控制台。
 * 设环境变量 STAGE3_DEBUG_LLM=1 开启。
 *
 * 本地 dev:    STAGE3_DEBUG_LLM=1 npm run dev
 * 在 Vercel:  Project Settings → Environment Variables 添加 STAGE3_DEBUG_LLM=1
 *            （只建议在 Preview / 开发环境开，Production 关闭以免污染日志）
 */
const STAGE3_DEBUG_LLM = process.env.STAGE3_DEBUG_LLM === "1";

function debugLogLlm(
  tag: string,
  payload: { sentence?: string; prompt?: string; raw?: unknown; parsed?: unknown },
): void {
  if (!STAGE3_DEBUG_LLM) return;
  const banner = `\n=== [stage3-llm:${tag}] ===`;
  console.log(banner);
  if (payload.sentence !== undefined) console.log("sentence:", payload.sentence);
  if (payload.raw !== undefined) {
    console.log(
      "raw:",
      typeof payload.raw === "string" ? payload.raw : JSON.stringify(payload.raw, null, 2),
    );
  }
  if (payload.parsed !== undefined) {
    console.log("parsed:", JSON.stringify(payload.parsed, null, 2));
  }
  console.log(`=== [/stage3-llm:${tag}] ===\n`);
}

/**
 * 当规则判定 meaning 未对齐时，用 LLM 二次确认局部功能是否成立。
 * 防止把 Body 级概念 checklist 误套到单句（如 Example 不要求同句含 internship）。
 */
async function confirmMeaningWithLlm(
  sentence: string,
  module: string,
  moduleDirection: string,
): Promise<boolean> {
  const prompt = [
    "You evaluate whether an English sentence fulfills its LOCAL discourse role in IELTS writing coaching.",
    `Current role: ${module}`,
    moduleDirection
      ? `Target meaning for this sentence: ${moduleDirection}`
      : "Use the role's typical local function.",
    "Rules:",
    "- Only check whether THIS sentence completes its local role (not the whole paragraph).",
    "- For 'example': a concrete contrast or instance supporting the prior reason is enough; do NOT require job/internship keywords if the example already shows textbook vs workplace mismatch.",
    "- For 'reason': a causal or contrast link explaining why is enough.",
    'Return JSON only: {"aligned": true|false, "reason": "one sentence"}',
    `Sentence: ${sentence}`,
  ].join("\n");

  try {
    const raw = await callLlmJson<{ aligned?: unknown }>(prompt);
    const parsed = raw?.aligned === true;
    debugLogLlm("confirmMeaning", { sentence, raw, parsed });
    return parsed;
  } catch (e) {
    debugLogLlm("confirmMeaning", { sentence, raw: `<error> ${String(e)}` });
    return false;
  }
}

/**
 * 当规则判定句子结构不可用时，用 LLM 二次确认。
 * 返回 true 表示 LLM 认为句子有完整的主谓结构（规则误判），可覆盖规则结论。
 * 返回 false / null 时保留规则结论。
 */
async function confirmStructuralWithLlm(sentence: string): Promise<boolean> {
  const prompt = [
    "You are checking whether an English sentence has a grammatically complete main clause.",
    "A complete main clause requires: a subject (noun/pronoun/gerund phrase) and a finite verb (any tense).",
    'Return JSON only: {"hasCompleteClause": true|false, "reason": "one sentence"}',
    "Do NOT evaluate grammar quality, word choice, or argument logic — only check for subject+finite-verb.",
    `Sentence: ${sentence}`,
  ].join("\n");

  try {
    const raw = await callLlmJson<{ hasCompleteClause?: unknown }>(prompt);
    const parsed = raw?.hasCompleteClause === true;
    debugLogLlm("confirmStructural", { sentence, raw, parsed });
    return parsed;
  } catch (e) {
    debugLogLlm("confirmStructural", { sentence, raw: `<error> ${String(e)}` });
    return false;
  }
}

async function reviewViabilityWithLlm(
  sentence: string,
): Promise<LocalViabilityResult | null> {
  const prompt = [
    "你是 IELTS 写作教练。任务：给单句找出可改进点，给出**启发式**反馈让用户**自己改**——绝不直接给答案。",
    "",
    "检查范围（必须覆盖，不要遗漏）：",
    "  hard 类（用户必须自己修，不能写入）：",
    "    - spelling：拼写错误（fundation → foundation）",
    "    - grammar_agreement：主谓一致 / which 指代单复数不一致 / 从句缺主语",
    "    - tense：时态错误或时态不一致",
    "    - article：冠词缺失或多余（pursue academic path 缺冠词）",
    "    - preposition：介词搭配错误",
    "  soft 类（可写入，但要指出让用户下次注意）：",
    "    - collocation：搭配不自然（competition advantage / sustainable studying）",
    "    - phrase_naturalness：短语/语序不地道（business model language）",
    "    - semantic_plausibility：语义可疑但语法没错",
    "    - target_role：人称/角色指代不自然（academic students）",
    "",
    "不要评估：论点完整性、段落衔接、立场强弱、上下文是否充分——只看这一句本身。",
    "",
    "===========  反馈风格【硬性要求】  ===========",
    "guideZh 是给学生的**启发**，不是答案。规则：",
    "  • 指出哪里出了问题（关联 anchor）",
    "  • 指出问题的方向（缺什么 / 词性错 / 语序反 / 搭配不搭）",
    "  • 用提问/反问让学生自己想（「想一想：…」「自己判断：…」）",
    "  • 禁止：直接给改后单词/短语/整句；禁止给候选词列表",
    "",
    "示例对照（务必模仿【好例】的写法）：",
    "  【错例】「which enable」应改为「which enables」，因为 pure knowledge 是单数。",
    "  【好例】which 这里指代什么名词？想一下那个名词是单数还是复数，再判断动词形式要不要变。",
    "",
    "  【错例】「competition advantage」应改为「competitive advantage」。",
    "  【好例】competition 是名词；advantage 前面通常用什么词性修饰？想一想 competition 对应的形容词。",
    "",
    "  【错例】if want 应改为 if they want。",
    "  【好例】这里 if 从句缺了主语——想一下：「谁」要 want？把主语补上。",
    "",
    "  【错例】「pursue academic path」应改为「pursue an academic path」。",
    "  【好例】academic path 是单数可数名词；想一下这里指特定的一条路还是泛指任意一条？再判断前面要补什么限定词。",
    "",
    "输出 JSON 严格如下，note / guideZh 用中文：",
    '{"score": number, "confidence": number, "issues": [',
    '  {',
    '    "kind": "<上述 9 种之一>",',
    '    "severityClass": "hard" | "soft",',
    '    "severity": 0.1~0.9,',
    '    "anchor": "<原句里命中的具体片段，必填>",',
    '    "note": "<中文一句话说明问题是什么>",',
    '    "guideZh": "<启发式中文提问/引导，按上面好例的风格；禁止给改后答案>"',
    '  }',
    "]}",
    "",
    "规则：",
    "  - score/confidence 在 0~1。",
    "  - issues 按 hard > soft、severity 降序排列。",
    "  - 同一类问题只报一次，挑最关键的那一处。",
    "  - 任何 issue 都不要填 replacement 字段（让用户自己想）。",
    "  - 没有任何问题时 issues 返回空数组，并 score=1, confidence=0.9。",
    "  - 凡是会让母语者愣一下的句子，必须至少报一条 issue 并定位到 anchor。",
    "",
    `句子：${sentence}`,
  ].join("\n");

  try {
    const raw = await callLlmJson<unknown>(prompt);
    const parsed = normalizeViabilityFromLlm(raw);
    debugLogLlm("reviewViability", { sentence, raw, parsed });
    return parsed;
  } catch (e) {
    debugLogLlm("reviewViability", { sentence, raw: `<error> ${String(e)}` });
    return null;
  }
}

function buildVars(
  state: SessionState,
  userMessage?: string,
): Record<string, string> {
  const base: Record<string, string> = {
    state_summary: stateSummary(state),
    user_message: userMessage ?? "",
    rule_hints: buildRuleHintsBlock(state),
  };

  if (state.handoff) {
    base.handoff_json = JSON.stringify(state.handoff);
  }
  if (state.s1) {
    base.s1_position = state.s1.position;
    base.s1_json = JSON.stringify(state.s1);
  }
  if (state.s2) {
    base.body1_point = state.s2.body1Point;
    base.body2_point = state.s2.body2Point;
    base.body1_angle = state.s2.body1Angle;
    base.body2_angle = state.s2.body2Angle;
    base.body1_logic = state.s2.body1Logic?.slots
      ? JSON.stringify(state.s2.body1Logic.slots)
      : (state.s2.body1.chainSummary ?? state.s2.body1Logic?.raw ?? "");
    base.body2_logic = state.s2.body2Logic?.slots
      ? JSON.stringify(state.s2.body2Logic.slots)
      : (state.s2.body2.chainSummary ?? state.s2.body2Logic?.raw ?? "");
    base.s2_json = JSON.stringify({
      body1: state.s2.body1,
      body2: state.s2.body2,
    });
  }
  if (state.coachContext?.openIssue) {
    base.open_issue = state.coachContext.openIssue;
  }
  if (state.coachContext?.lastQuestion) {
    base.last_coach_question = state.coachContext.lastQuestion;
  }
  if (state.subStep === "S1_EVAL" && !state.handoffLocked) {
    const substance = assessEssaySubstance(state);
    const { contentReady } = assessExplorationContent(state, userMessage);
    const explorationSides = explorationSideStatus(userMessages(state));
    base.substance_assessment = JSON.stringify({
      contentReady,
      substanceSufficient: substance.sufficient,
      explorationSides,
      gaps: substance.gaps,
      handoffPhase: state.coachContext?.handoffPhase ?? "exploring",
      exploreRound: state.coachContext?.exploreRound ?? 0,
    });
  }
  if (state.subStep === "S2_2_BODY1" || state.subStep === "S2_3_BODY2") {
    const body: WorkshopBodyKey = state.subStep === "S2_2_BODY1" ? "body1" : "body2";
    const substance = assessParagraphSubstance(state, body, userMessage);
    const seg = body === "body1" ? state.s2?.body1 : state.s2?.body2;
    base.paragraph_substance_assessment = JSON.stringify({
      substanceSufficient: substance.sufficient,
      gaps: substance.gaps,
      chainPhase: seg?.chainPhase ?? "coaching",
      chainBuildStep: state.coachContext?.chainBuildStep ?? "claim",
      bodyPoint: body === "body1" ? state.s2?.body1Point : state.s2?.body2Point,
      bodyAngle: body === "body1" ? state.s2?.body1Angle : state.s2?.body2Angle,
      coachMode: "hybrid_llm_role_rule_gate",
    });
  }

  if (state.s3) {
    const sampledTask = sampleStage3Task(state);
    const body = sampledTask?.body ?? state.s3.currentBody;
    const mod = sampledTask?.taskType ?? null;
    base.current_body = body;
    base.current_module = mod ?? "";
    base.module_label = mod ? MODULE_LABELS[mod] ?? mod : "";
    base.mode = state.s3.mode;
    const bp = normalizeBlueprint(state, state.s3.blueprint);
    if (body !== "conclusion" && mod) {
      const b = bp[body as "body1" | "body2"];
      const flow = b?.logicFlow;
      if (flow) {
        const dir =
          mod === "claim"
            ? flow.claimDirection
            : mod === "reason"
              ? flow.reasonDirection
              : flow.supportDirection;
        base.module_direction = dir;
      }
    } else if (mod && bp.conclusion) {
      base.module_direction =
        mod === "conclusion_restate"
          ? bp.conclusion.restateDirection
          : bp.conclusion.summaryLogicDirection;
    }
    if (state.subStep === "S3_3_BODY_CHECK") {
      base.body_sentences = integrateBodySentences(state, body);
    }
    if (state.subStep === "S3_2_MODULE" && userMessage?.trim()) {
      const sentenceTask = resolveStage3Module(state) ?? undefined;
      const meaning = assessMeaningAlignment(
        state,
        userMessage,
        sentenceTask,
      );
      const diagnosis = diagnoseSentence(userMessage, sentenceTask ?? undefined);
      base.sentence_diagnosis = JSON.stringify({
        meaningAligned: meaning.aligned,
        meaningMissing: meaning.missing,
        pass: diagnosis.pass,
        priority: diagnosis.priority,
        kind: diagnosis.kind,
        labelZh: diagnosis.labelZh,
        repairQuestionZh: diagnosis.repairQuestionZh,
        hintZh: diagnosis.hintZh,
      });
    }
    if (state.s3.orchestrator) {
      base.orchestrator_snapshot = JSON.stringify(state.s3.orchestrator);
      base.current_focus_layer = state.s3.orchestrator.focusLayer;
    }
    if (state.coachContext?.sentenceState) {
      base.sentence_state = state.coachContext.sentenceState;
    }
    if (state.coachContext?.orchestratorGate) {
      base.orchestrator_gate_telemetry = JSON.stringify(
        state.coachContext.orchestratorGate,
      );
    }
  }
  return base;
}

async function processLlmTurn(
  state: SessionState,
  moduleId: PromptModuleId,
  userMessage?: string,
): Promise<{ reply: string; state: SessionState; autoContinue: boolean }> {
  const prevSubStep = state.subStep;
  let result = await runPrompt(
    state,
    moduleId,
    buildVars(state, userMessage),
    userMessage,
  );

  let nextState = state;
  let autoContinue = false;
  const gated = applyOrchestratorHardGate(state, result, prevSubStep);
  if (gated) {
    result = gated.result;
    nextState = gated.state;
    const reply = formatCoachDisplay(result, {
      stage1: prevSubStep === "S1_EVAL",
      stage2: prevSubStep === "S2_2_BODY1" || prevSubStep === "S2_3_BODY2",
      stage3Sentence: prevSubStep === "S3_2_MODULE",
    });
    nextState = appendChat(nextState, "assistant", reply);
    return { reply, state: nextState, autoContinue: false };
  }
  nextState = observeOrchestratorHardGate(state, {
    subStep: prevSubStep,
    hit: false,
  });

  if (prevSubStep === "S1_EVAL") {
    const processed = postProcessStage1(nextState, result, userMessage);
    result = processed.result;
    nextState = mergeS1FromResult(processed.state, result);
    const reply = formatCoachDisplay(result, { stage1: true });
    nextState = appendChat(nextState, "assistant", reply);
    return { reply, state: nextState, autoContinue: false };
  }

  if (prevSubStep === "S2_2_BODY1" || prevSubStep === "S2_3_BODY2") {
    const body: BodyKey = prevSubStep === "S2_2_BODY1" ? "body1" : "body2";
    const processed = postProcessStage2(nextState, result, body, userMessage);
    result = processed.result;
    nextState = applyBodyCoachUpdate(processed.state, body, result, userMessage);
    const reply = formatCoachDisplay(result, { stage2: true });
    nextState = appendChat(nextState, "assistant", reply);
    return { reply, state: nextState, autoContinue: false };
  }

  if (prevSubStep === "S3_2_MODULE") {
    let viabilityOverride: LocalViabilityResult | undefined;
    let meaningAlignedOverride: boolean | undefined;
    const sentenceInput =
      userMessage?.trim() ?? nextState.s3?.pendingSentence?.trim() ?? "";
    const sentenceTask = resolveStage3Module(nextState) ?? undefined;
    let structuralOverride: boolean | undefined;
    if (sentenceInput) {
      const meaning = assessMeaningAlignment(nextState, sentenceInput, sentenceTask);
      if (!meaning.aligned && sentenceTask) {
        const moduleDir = getModuleDirection(nextState);
        const llmMeaningOk = await confirmMeaningWithLlm(
          sentenceInput,
          sentenceTask,
          moduleDir,
        );
        if (llmMeaningOk) meaningAlignedOverride = true;
      }
      const effectiveMeaning = meaning.aligned || !!meaningAlignedOverride;
      const structuralWorkable = looksStructurallyWorkable(sentenceInput);
      if (effectiveMeaning && !structuralWorkable) {
        // 规则判定结构不可用时，LLM 二次确认，防止误判。
        const llmConfirm = await confirmStructuralWithLlm(sentenceInput);
        if (llmConfirm) structuralOverride = true;
      }
      const effectiveStructural = structuralOverride ?? structuralWorkable;
      if (effectiveMeaning && effectiveStructural) {
        const local = assessLocalViability(sentenceInput);
        const localHasHard = local.issues.some(
          (i) => (i.severityClass ?? classifyViabilityKind(i.kind)) === "hard",
        );
        // 本地规则目前只有 soft 类，无法覆盖语法/拼写——所以即便本地命中 issue，
        // 也仍然让 LLM 兜底扫一遍 hard error；本地若已发现 hard issue 则可省。
        // 仅当本地满分（score≥0.75, confidence≥0.8）时跳过 LLM。
        const fullyConfident = local.score >= 0.75 && local.confidence >= 0.8;
        const needsScout = !localHasHard && !fullyConfident;
        if (needsScout) {
          const llmReviewed = await reviewViabilityWithLlm(sentenceInput);
          if (llmReviewed) {
            viabilityOverride = mergeViability(local, llmReviewed);
          }
        }
      }
    }
    const processed = postProcessStage3Sentence(
      nextState,
      result,
      userMessage,
      viabilityOverride,
      structuralOverride,
      meaningAlignedOverride,
    );
    result = processed.result;
    nextState = processed.state;
    const reply = formatCoachDisplay(result, { stage3Sentence: true });
    nextState = appendChat(nextState, "assistant", reply);
    return { reply, state: nextState, autoContinue: false };
  }

  let reply = formatCoachDisplay(result);
  const advance = shouldAdvance(state, prevSubStep, result);

  if (markerWhenAdvance(prevSubStep, result, advance)) {
    const m = markerForSubStep(prevSubStep);
    if (m) reply = appendMarker(reply, m);
  }

  if (prevSubStep === "S3_1_BLUEPRINT" && advance) {
    nextState = applyBlueprint(nextState, result);
    autoContinue = true;
  } else if (prevSubStep === "S3_3_BODY_CHECK") {
    if (result.verdict === "pass" && advance) {
      const integrated =
        result.integratedBodyText ??
        integrateBodySentences(nextState, nextState.s3!.currentBody);
      nextState = afterBodyCheck(
        {
          ...nextState,
          s3: {
            ...nextState.s3!,
            integratedBodies: {
              ...nextState.s3!.integratedBodies,
              ...(nextState.s3!.currentBody !== "conclusion"
                ? { [nextState.s3!.currentBody]: integrated }
                : {}),
            },
          },
        },
        { ...result, integratedBodyText: integrated },
      );
      autoContinue = nextState.subStep === "S3_2_MODULE";
    } else if (result.verdict === "fail" || result.verdict === "coach") {
      nextState = afterBodyCheck(nextState, result);
    }
  }

  nextState = appendChat(nextState, "assistant", reply);
  return { reply, state: nextState, autoContinue };
}

export async function handleInit(state: SessionState): Promise<TurnResponse> {
  const s0 = ensureMigrated(state);
  const opening = STAGE1_OPENING;
  const s = appendChat(
    { ...s0, subStep: "S1_EVAL" as SessionState["subStep"] },
    "assistant",
    opening,
  );
  return {
    replies: [opening],
    state: s,
    requiresConfirm: false,
    canSubmit: true,
  };
}

export async function handleConfirmChainProposal(
  state: SessionState,
  body: WorkshopBodyKey,
): Promise<TurnResponse> {
  const s0 = ensureMigrated(state);
  const seg = body === "body1" ? s0.s2?.body1 : s0.s2?.body2;
  const proposal = seg?.chainProposal;

  if (!proposal || seg?.chainPhase !== "proposed") {
    return {
      replies: ["请先与教练聊清论证，待左侧出现「教练整理链条」后再确认。"],
      state: s0,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  let s = applyChainProposalToState(s0, body, proposal);
  const logicKey = body === "body1" ? "body1Logic" : "body2Logic";
  const synthetic: LlmTurnResult = {
    verdict: "pass",
    advance: true,
    userVisibleText: "",
    logicBreakdown: logicBreakdownFromProposal(proposal, body),
    extracted: {
      [logicKey]: {
        primaryDriver: "causal",
        slots: proposal.slots,
        missing: [],
        raw: proposal.draft,
      },
    },
  };

  const replies: string[] = [];

  if (body === "body1") {
    s = applyStage2Body1Advance(s, synthetic, proposal.draft);
    const reply = `Body1 论证链已确认。${bodyTaskAfterBody1(s)}`;
    replies.push(reply);
    s = appendChat(s, "assistant", reply);
    return {
      replies,
      state: s,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  s = applyStage2Body2Advance(s, synthetic, proposal.draft);
  let reply = "Body2 论证链已确认，正在准备逐句写作…";
  replies.push(reply);
  s = appendChat(s, "assistant", reply);

  const bp = await processLlmTurn(s, "P3_1");
  replies.push(bp.reply);
  s = bp.state;

  if (bp.autoContinue && s.subStep === "S3_2_MODULE") {
    const next = await processLlmTurn(s, "P3_2");
    replies.push(next.reply);
    s = next.state;
  }

  return {
    replies,
    state: s,
    requiresConfirm: false,
    canSubmit: s.subStep !== "COMPLETED",
  };
}

export async function handleConfirmHandoffProposal(
  state: SessionState,
): Promise<TurnResponse> {
  const s0 = ensureMigrated(state);
  const raw = s0.handoffProposal;
  if (!raw) {
    return {
      replies: ["还没有可确认的整理，请继续在右侧聊审题。"],
      state: s0,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  const proposal =
    sanitizeHandoffProposal(enrichHandoffFromChat(raw, s0), s0) ?? raw;

  const s: SessionState = {
    ...s0,
    handoff: { ...proposal },
    handoffProposal: undefined,
    coachContext: {
      ...s0.coachContext,
      handoffPhase: "editing",
      readyForHandoff: true,
    },
  };
  const reply =
    "好，已填入左侧。请核对六栏，无误后点「提交审题定稿」，再进入 Body1。";
  return {
    replies: [reply],
    state: appendChat(s, "assistant", reply),
    requiresConfirm: false,
    canSubmit: true,
  };
}

export async function handleSubmitHandoff(
  state: SessionState,
  handoff: Stage1Handoff,
): Promise<TurnResponse> {
  const handoffEnriched = enrichHandoffFromChat(handoff, state);
  let s = ensureMigrated({ ...state, handoff: handoffEnriched });

  const v = validateHandoff(handoffEnriched);
  if (!v.ok) {
    return {
      replies: [v.errors.join("；")],
      state: s,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  const rules = ruleHintsForHandoff(handoffEnriched);
  if (rules.blockAdvance) {
    return {
      replies: [
        `请先调整审题定稿：${rules.warnings.join(" ")}`,
      ],
      state: s,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  s = applyHandoffToState(s, handoffEnriched);

  let result: LlmTurnResult;
  try {
    result = await runPrompt(s, "P1H", {
      query: s.topic,
      handoff_json: JSON.stringify(handoffEnriched),
      s1_json: JSON.stringify(s.s1 ?? {}),
      state_summary: stateSummary(s),
    });
  } catch {
    result = {
      verdict: "pass",
      advance: true,
      userVisibleText: `审题定稿已收到。${bodyTaskAfterHandoff(s)}`,
    };
  }

  if (!shouldAdvance(s, "S1_EVAL", result)) {
    const reply = formatCoachDisplay({
      ...result,
      advance: false,
    });
    return {
      replies: [reply],
      state: appendChat(s, "assistant", reply),
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  s = applyHandoffAdvance(s);
  const reply = `${buildStage1SubmitFeedback(handoffEnriched)}\n\n${bodyTaskAfterHandoff(s)}`;
  s = appendChat(s, "assistant", reply);

  return {
    replies: [reply],
    state: s,
    requiresConfirm: false,
    canSubmit: true,
  };
}

export async function handleTurn(
  state: SessionState,
  message: string,
): Promise<TurnResponse> {
  const replies: string[] = [];
  let s = ensureMigrated(state);
  s = applyOrchestratorShadow(s, message);
  s = appendChat(s, "user", message);
  const moduleId = resolvePromptModule(s);

  if (moduleId === "OPENING" || moduleId === "NONE") {
    return {
      replies: ["训练已完成或未初始化。"],
      state: s,
      requiresConfirm: false,
      canSubmit: false,
    };
  }

  if (s.subStep === "COMPLETED") {
    return {
      replies: ["恭喜，本篇特训已完成！可重新开始新题目。"],
      state: s,
      requiresConfirm: false,
      canSubmit: false,
    };
  }

  if (s.subStep === "S1_EVAL" && !s.handoffLocked) {
    if (isProposalAffirmation(message)) {
      const prop = resolveConfirmableHandoffProposal(s);
      if (prop) {
        return handleConfirmHandoffProposal({
          ...s,
          handoffProposal: prop,
          coachContext: { ...s.coachContext, handoffPhase: "proposed" },
        });
      }
    }

    if (isStage1ChainLeakMessage(message)) {
      const reply =
        "这条更像 Body1 搭链里的句子。请先完成审题：点「确认整理并填入」→「提交审题定稿」，再写论证链。";
      return {
        replies: [reply],
        state: appendChat(s, "assistant", reply),
        requiresConfirm: false,
        canSubmit: true,
      };
    }

    if (s.coachContext?.handoffPhase === "proposed" && s.handoffProposal) {
      const reply =
        "整理稿已给出。请点左侧「确认整理并填入」，或回复「是」；要改哪一栏直接说。";
      return {
        replies: [reply],
        state: appendChat(s, "assistant", reply),
        requiresConfirm: false,
        canSubmit: true,
      };
    }
  }

  if (
    s.subStep === "S3_2_MODULE" &&
    (s.s3?.mode === "assign" ||
      s.s3?.mode === "coach" ||
      s.s3?.mode === "feedback")
  ) {
    const intent = detectStage3SentenceIntent(message);
    if (intent === "scaffold") {
      const reply = buildScaffoldResponse(s);
      return {
        replies: [reply],
        state: appendChat(s, "assistant", reply),
        requiresConfirm: false,
        canSubmit: true,
      };
    }
    if (intent === "meta") {
      // "打磨哪里 / 哪里有问题 / 错在哪" 等元提问：直接回放上一轮 viability issues，
      // 不再让用户重新贴一遍上一版。
      const reply = buildMetaRecallResponse(s);
      return {
        replies: [reply],
        state: appendChat(s, "assistant", reply),
        requiresConfirm: false,
        canSubmit: true,
      };
    }
  }

  if (s.subStep === "S3_2_MODULE" && s.s3?.mode === "assign") {
    const v = validateUserSentence(message);
    if (!v.ok) {
      return {
        replies: [
          buildStage3OutputContract({
            module: sampleStage3Task(s)?.taskType ?? null,
            meaningOk: false,
            meaningReason: "未进入判定（输入未通过基本规则）",
            paragraphFit: false,
            paragraphReason: v.error!,
            feedback: `输入有限制：${v.error!}\n请把这一句拆成一条不超过 45 词的英文句，再发一次。`,
            suggestedRevision: "把核心一句保留，把展开/解释拆到下一句。",
            nextStep: "改成单句（≤45 词）后重新发送。",
          }),
        ],
        state: s,
        requiresConfirm: false,
        canSubmit: true,
      };
    }
    s = {
      ...s,
      s3: { ...s.s3!, mode: "feedback", pendingSentence: message },
    };
    const { reply, state: ns } = await processLlmTurn(s, "P3_2", message);
    replies.push(reply);
    const advanced = await autoAdvanceIfPassable(ns, replies);
    return {
      replies,
      state: advanced,
      requiresConfirm: false,
      canSubmit: advanced.subStep !== "COMPLETED",
    };
  }

  if (
    s.subStep === "S3_2_MODULE" &&
    (s.s3?.mode === "feedback" || s.s3?.mode === "coach")
  ) {
    const v = validateUserSentence(message);
    if (!v.ok) {
      return {
        replies: [
          buildStage3OutputContract({
            module: sampleStage3Task(s)?.taskType ?? null,
            meaningOk: false,
            meaningReason: "未进入判定（输入未通过基本规则）",
            paragraphFit: false,
            paragraphReason: v.error!,
            feedback: `输入有限制：${v.error!}\n请把这一句拆成一条不超过 45 词的英文句，再发一次。`,
            suggestedRevision: "把核心一句保留，把展开/解释拆到下一句。",
            nextStep: "改成单句（≤45 词）后重新发送。",
          }),
        ],
        state: s,
        requiresConfirm: false,
        canSubmit: true,
      };
    }
    s = {
      ...s,
      s3: {
        ...s.s3!,
        pendingSentence: message,
        mode: "coach",
      },
    };
  }

  let auto = true;
  let guard = 0;
  while (auto && guard < 4) {
    guard++;
    const currentModule = resolvePromptModule(s);
    if (currentModule === "NONE" || currentModule === "OPENING") break;

    if (
      currentModule === "P3_2" &&
      s.s3?.mode === "assign" &&
      guard > 1 &&
      s.s3.lastAssignText
    ) {
      break;
    }

    const needsUser =
      s.subStep !== "S3_1_BLUEPRINT" &&
      !(s.subStep === "S3_2_MODULE" && s.s3?.mode === "assign" && guard > 1);

    const userMsg =
      s.subStep === "S3_2_MODULE" && s.s3?.mode === "feedback"
        ? message
        : guard === 1
          ? message
          : undefined;

    if (needsUser && guard > 1) break;

    const { reply, state: ns, autoContinue } = await processLlmTurn(
      s,
      currentModule as PromptModuleId,
      userMsg,
    );
    replies.push(reply);
    s = ns;
    auto = autoContinue;
  }

  s = await autoAdvanceIfPassable(s, replies);
  const requiresConfirm = false;

  return {
    replies,
    state: s,
    requiresConfirm,
    canSubmit: !requiresConfirm && s.subStep !== "COMPLETED",
  };
}

export async function handleConfirm(state: SessionState): Promise<TurnResponse> {
  const s0 = ensureMigrated(state);
  const acceptable =
    s0.coachContext?.sentenceState === "stabilizable" ||
    s0.coachContext?.sentenceState === "refine_needed";
  if (
    s0.subStep !== "S3_2_MODULE" ||
    !s0.s3?.pendingSentence ||
    !acceptable
  ) {
    return {
      replies: ["当前无需确认。"],
      state: s0,
      requiresConfirm: false,
      canSubmit: true,
    };
  }

  let s = advanceModuleAfterPass(s0);
  const replies: string[] = [];

  if (s.subStep === "S3_3_BODY_CHECK") {
    const { reply, state: ns, autoContinue } = await processLlmTurn(s, "P3_3");
    replies.push(reply);
    s = ns;
    if (autoContinue && s.subStep === "S3_2_MODULE") {
      const next = await processLlmTurn(s, "P3_2");
      replies.push(next.reply);
      s = next.state;
    }
  } else if (s.subStep === "S3_2_MODULE") {
    const { reply, state: ns } = await processLlmTurn(s, "P3_2");
    replies.push(reply);
    s = ns;
  }

  return {
    replies,
    state: s,
    requiresConfirm: false,
    canSubmit: s.subStep !== "COMPLETED",
  };
}
