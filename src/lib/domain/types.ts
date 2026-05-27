export type QuestionType =
  | "discuss"
  | "agree"
  | "adv_disadv"
  | "two_part"
  | "pos_neg"
  | "unknown";

/** Stage1 探索侧：sideA = Body1，sideB = Body2（不再绑定就业/学术语义） */
export type ExplorationSide = "sideA" | "sideB";

export type HandoffGap = ExplorationSide | "ready" | "none";

export interface ExplorationSides {
  sideA: boolean;
  sideB: boolean;
}

export type SubStep =
  | "S1_AWAIT"
  | "S1_EVAL"
  | "S2_2_BODY1"
  | "S2_3_BODY2"
  | "S2_4_CONCLUSION"
  | "S3_1_BLUEPRINT"
  | "S3_2_MODULE"
  | "S3_3_BODY_CHECK"
  | "COMPLETED";

export type SegmentStatus = "coaching" | "ready";

export type ModuleId =
  | "claim"
  | "reason"
  | "example"
  | "impact"
  | "evaluation"
  | "conclusion_restate";

export type BodyKey = "body1" | "body2" | "conclusion";

export type WorkshopBodyKey = "body1" | "body2";

export type ParagraphSlot =
  | "claim"
  | "reason"
  | "elaboration"
  | "support"
  | "example"
  | "link";

export interface ParagraphSlots {
  claim?: string | null;
  reason?: string | null;
  elaboration?: string | null;
  support?: string | null;
  example?: string | null;
  link?: string | null;
}

export interface LogicBreakdown {
  target: "subpoints" | "body1" | "body2";
  chainSummary?: string;
  slots: ParagraphSlots;
  missing?: ParagraphSlot[];
  userBlobSummary?: string;
}

export interface LogicFill {
  primaryDriver?: "causal" | "mechanism" | "support" | "condition";
  fills?: Record<string, string>;
  slots?: ParagraphSlots;
  missing?: ParagraphSlot[];
  raw?: string;
}

export interface Stage1Handoff {
  taskUnderstanding: string;
  position: string;
  body1Point: string;
  body1Angle: string;
  body2Point: string;
  body2Angle: string;
  questionType?: string;
}

export type ChainPhase = "coaching" | "proposed" | "locked";

export interface ChainProposal {
  chainSummary: string;
  slots: ParagraphSlots;
  draft: string;
}

/** Stage2 功能覆盖快照（内层 discourse，0–1 分数 + 阈值布尔） */
export interface ChainCoverageSnapshot {
  scores: {
    claim: number;
    causal: number;
    grounding: number;
    closure: number;
  };
  claimEstablished: boolean;
  causalExplained: boolean;
  concreteGrounding: boolean;
  argumentativeClosure: boolean;
  missing: Array<"causal" | "grounding" | "closure">;
}

export interface ChainWorkflowSnapshot {
  kind: string;
  title: string;
  detail?: string;
  nextAction?: string;
}

export interface BodySegment {
  status: SegmentStatus;
  draft: string;
  chainSummary?: string;
  slots?: ParagraphSlots;
  openIssues?: string[];
  chainPhase?: ChainPhase;
  chainProposal?: ChainProposal;
  /** 论证功能覆盖（左栏进度主依据） */
  chainCoverage?: ChainCoverageSnapshot;
  /** 工作坊工作流状态（与 canPropose 对齐） */
  chainWorkflow?: ChainWorkflowSnapshot;
}

export interface Stage1Data {
  questionType: string;
  taskUnderstanding: string;
  position: string;
}

export interface BlueprintBody {
  coreIdea: string;
  logicFlow: {
    claimDirection: string;
    reasonDirection: string;
    supportDirection: string;
  };
}

export interface Blueprint {
  body1: BlueprintBody;
  body2: BlueprintBody;
  conclusion: {
    /** Stage 3 conclusion 段唯一目标：重申立场。 */
    restateDirection: string;
  };
}

export type HandoffPhase = "exploring" | "proposed" | "editing" | "locked";

export interface CoachContext {
  sentenceIssue?: {
    kind: string;
    status: "active" | "improving" | "resolved" | "regressed";
    lastSnippet?: string;
    consecutiveTurns: number;
    confidenceDelta?: number;
  };
  sentenceState?: "repair_needed" | "workable" | "refine_needed" | "stabilizable";
  sentenceIssues?: Array<{
    kind: string;
    priority: "P0" | "P1" | "P2" | "P3";
    status: "active" | "improving" | "resolved" | "regressed";
    lastSnippet?: string;
    hits: number;
    consecutiveTurns: number;
  }>;
  /** 上一轮的 viability issues（保留 anchor/guideZh/severityClass），
   *  供"打磨哪里"等 meta 重述回放，避免让用户再贴一遍上一版。 */
  lastViabilityIssues?: Array<{
    kind: string;
    severityClass?: "hard" | "soft";
    severity?: number;
    note: string;
    anchor?: string;
    guideZh?: string;
    replacement?: string;
  }>;
  orchestratorGate?: {
    totalHits: number;
    consecutiveHits: number;
    hardModeTurns: number;
    lastLayer?: "essay" | "paragraph";
    lastReason?: string;
    lastSubStep?: string;
    downgradeSuggested?: boolean;
    suggestedMode?: "soft" | "shadow";
    suggestReason?: string;
    suggestedAtHits?: number;
  };
  lastQuestion?: string;
  openIssue?: string;
  exploreRound?: number;
  readyForHandoff?: boolean;
  handoffPhase?: HandoffPhase;
  /** 本轮 Stage1 是否已在聊天里教过「切入面」 */
  angleTeachDone?: boolean;
  /** Stage2 当前搭链环节 */
  chainBuildStep?: "claim" | "reason" | "example" | "link" | "ready";
  /** Stage2 同一环节追问计数（防无限追问） */
  chainStepAskCount?: number;
  /** Stage2 上一次追问的环节 */
  chainLastAskedStep?: "claim" | "reason" | "example" | "link" | "ready";
}

export interface SessionState {
  version: 2;
  sessionId: string;
  questionId: string;
  topic: string;
  /** 题库标注的题型，stage 1 引导分流要用（discuss / agree / adv_disadv ...）。
   *  老 session 没有此字段时按 "unknown" 处理，会走通用 generic 路径。 */
  questionHintType?: QuestionType;
  stage: 1 | 2 | 3;
  subStep: SubStep;
  markers: {
    stage1Pass: boolean;
    subPointsPass: boolean;
    subBody1Pass: boolean;
    /** body2 完成、可进入 conclusion 子环节（S2_4_CONCLUSION） */
    subBody2Pass: boolean;
    /** 整个 stage 2 完成（含 conclusion 子环节），可进 stage 3 */
    stage2Pass: boolean;
  };
  handoff?: Stage1Handoff;
  /** 教练整理的 6 栏提案，待用户确认填入 */
  handoffProposal?: Stage1Handoff;
  handoffLocked?: boolean;
  coachContext?: CoachContext;
  s1?: Stage1Data;
  s2?: {
    body1Point: string;
    body2Point: string;
    body1Angle: string;
    body2Angle: string;
    body1: BodySegment;
    body2: BodySegment;
    body1Logic?: LogicFill;
    body2Logic?: LogicFill;
    /** Stage 2 conclusion 子环节的产出：用户对 conclusion 这一句的中文目标
     *  （重申立场）。Stage 3 的 restateDirection 优先用它。
     *  老 session 没有这个字段时，blueprint 退回到 handoff.position。 */
    conclusionPoint?: string;
  };
  s3?: {
    orchestrator?: {
      mode: "shadow" | "soft" | "hard";
      focusLayer: "essay" | "paragraph" | "sentence";
      reason: string;
      essayConfidence: number;
      paragraphConfidence: number;
      decisionConfidence: number;
      conflict: boolean;
      fallbackApplied: boolean;
      essayContradiction: boolean;
      paragraphDrift: boolean;
      sentenceIssuesLikely: boolean;
    };
    blueprint?: Blueprint;
    modulePlan: Record<BodyKey, ModuleId[]>;
    currentBody: BodyKey;
    moduleIndex: number;
    mode: "assign" | "feedback" | "coach";
    confirmedSentences: Partial<Record<string, string[]>>;
    pendingSentence?: string;
    lastAssignText?: string;
    integratedBodies: Partial<Record<"body1" | "body2", string>>;
    conclusionText?: string;
  };
  chatHistory: Array<{ role: "user" | "assistant"; content: string }>;
  leftPanelNotes: string;
}

export interface Question {
  id: string;
  title: string;
  prompt: string;
  hintType: QuestionType;
}

export type PromptModuleId =
  | "P1"
  | "P1H"
  | "P2_2"
  | "P2_3"
  | "P3_1"
  | "P3_2"
  | "P3_3";

export type HandoffFieldTarget =
  | "taskUnderstanding"
  | "position"
  | "body1Point"
  | "body1Angle"
  | "body2Point"
  | "body2Angle";

export interface LanguageSupport {
  keywords?: string[];
  phraseFragments?: string[];
  starterStructures?: string[];
}

export interface LlmTurnResult {
  verdict: "pass" | "fail" | "assign" | "coach";
  /** 为 true 时系统才切 subStep / 打暗号 */
  advance?: boolean;
  mirror?: string;
  coachQuestion?: string;
  userVisibleText: string;
  logicBreakdown?: LogicBreakdown;
  languageSupport?: LanguageSupport;
  extracted?: Record<string, unknown>;
  /** 教练判断：两侧料是否够写一篇充实作文 */
  essaySubstanceSufficient?: boolean;
  gapsRemaining?: string[];
  proposedHandoff?: Stage1Handoff;
  proposalSummary?: string;
  paragraphSubstanceSufficient?: boolean;
  chainProposal?: ChainProposal;
  blueprint?: Blueprint;
  modulePlan?: Record<BodyKey, ModuleId[]>;
  moduleComplete?: boolean;
  needsSupplementSentence?: boolean;
  confirmedSentence?: string | null;
  action?: "append_sentence" | "proceed_next_body";
  missingGap?: "reason" | "example" | "impact" | null;
  integratedBodyText?: string | null;
  syntaxHint?: string | null;
  /** Stage2：本轮用户话在论证链中的功能（理解轨） */
  chainTurnRole?: "reason" | "example" | "link" | "none" | "meta";
  chainTurnQuality?: "ok" | "acceptable" | "weak" | "off_topic" | "none";
  chainTurnText?: string;
}
