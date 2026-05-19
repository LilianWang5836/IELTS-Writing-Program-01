export type QuestionType =
  | "discuss"
  | "agree"
  | "adv_disadv"
  | "two_part"
  | "pos_neg"
  | "unknown";

export type SubStep =
  | "S1_AWAIT"
  | "S1_EVAL"
  | "S2_1_SUBPOINTS"
  | "S2_2_BODY1"
  | "S2_3_BODY2"
  | "S3_1_BLUEPRINT"
  | "S3_2_MODULE"
  | "S3_3_BODY_CHECK"
  | "COMPLETED";

export type ModuleId =
  | "claim"
  | "reason"
  | "example"
  | "impact"
  | "evaluation"
  | "conclusion_restate"
  | "conclusion_summary";

export type BodyKey = "body1" | "body2" | "conclusion";

export interface LogicFill {
  primaryDriver?: "causal" | "mechanism" | "support" | "condition";
  fills?: Record<string, string>;
  raw?: string;
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
    restateDirection: string;
    summaryLogicDirection: string;
  };
}

export interface SessionState {
  version: 1;
  sessionId: string;
  questionId: string;
  topic: string;
  stage: 1 | 2 | 3;
  subStep: SubStep;
  markers: {
    stage1Pass: boolean;
    subPointsPass: boolean;
    subBody1Pass: boolean;
    stage2Pass: boolean;
  };
  s1?: Stage1Data;
  s2?: {
    body1Point: string;
    body2Point: string;
    body1Logic?: LogicFill;
    body2Logic?: LogicFill;
  };
  s3?: {
    blueprint?: Blueprint;
    modulePlan: Record<BodyKey, ModuleId[]>;
    currentBody: BodyKey;
    moduleIndex: number;
    mode: "assign" | "feedback";
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
  | "P2_1"
  | "P2_2"
  | "P2_3"
  | "P3_1"
  | "P3_2"
  | "P3_3";

export interface LlmTurnResult {
  verdict: "pass" | "fail" | "assign";
  userVisibleText: string;
  extracted?: Record<string, unknown>;
  blueprint?: Blueprint;
  modulePlan?: Record<BodyKey, ModuleId[]>;
  moduleComplete?: boolean;
  needsSupplementSentence?: boolean;
  confirmedSentence?: string | null;
  action?: "append_sentence" | "proceed_next_body";
  missingGap?: "reason" | "example" | "impact" | null;
  integratedBodyText?: string | null;
}
