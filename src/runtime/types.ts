/** Append-only trace schema version — bump only with migration notes. */
export const COACH_TRACE_SCHEMA_VERSION = 1;

export type CoachRuntimeMode = "full" | "deterministic" | "legacy";

export type DepthLevel = "missing" | "weak" | "adequate";
export type PartialLevel = "missing" | "partial" | "adequate";
export type PositionLean = "pro" | "con" | "balanced" | "unknown";
export type PrimaryGap = "causal" | "grounding" | "closure" | null;
export type Stage2Need = "claim" | "causal" | "grounding" | "closure" | "ready";

export interface SemanticFeatures {
  hasStance: boolean;
  stanceMarkers: string[];
  hasConcession: boolean;
  concessionMarkers: string[];
  benefitCount: number;
  drawbackCount: number;
  bodyPointCount: { body1: number; body2: number };
  causalMarkers: string[];
  exampleMarkers: string[];
  closureMarkers: string[];
  exampleCount: number;
  topicTerms: string[];
  genericPhrases: string[];
  responseWordCount: number;
}

export interface DiscourseSignals {
  stanceClarity: "missing" | "weak" | "clear";
  argumentBalance: "one_sided" | "balanced" | "unknown";
  concessionQuality: DepthLevel;
  elaborationDepth: DepthLevel;
  causalStrength: PartialLevel;
  exampleDepth: PartialLevel;
  coherenceRisk: "low" | "medium" | "high";
  topicCoverage: "off" | "partial" | "on";
  reasonSpecificity: "generic" | "specific";
  userTurnFunctionCount: number;
}

export interface CoachingSignals {
  readyToFinalize: boolean;
  themesComplete: boolean;
  contentReady: boolean;
  positionLean: PositionLean;
  benefitDepth: DepthLevel;
  drawbackDepth: DepthLevel;
  bodyPointDepth: { body1: DepthLevel; body2: DepthLevel };
  concessionCoverage: DepthLevel;
  rewriteRisk: "low" | "medium" | "high";
  refinementCandidate: boolean;
  currentNeed: Stage2Need;
  primaryGap: PrimaryGap;
  gapStrength: PartialLevel;
  discourseReady: boolean;
  topicAnchor: string;
}

export interface EngagementSignals {
  responseLengthTrend: "stable" | "shrinking" | "growing";
  semanticEntropy: "low" | "medium" | "high";
  repetitionRisk: boolean;
  minimalCompliance: boolean;
  fatigueHigh: boolean;
  fatigueConfidence: "certain" | "uncertain";
}

export interface CoachWorldState {
  subStep: string;
  phaseLegal: boolean;
  handoffPhase?: string;
  chainPhase?: string;
  body?: "body1" | "body2";
  semantic: SemanticFeatures;
  discourse: DiscourseSignals;
  coaching: CoachingSignals;
  engagement: EngagementSignals;
  lastQuestion: string;
  exploreRound: number;
  refinementVetoBudgetRemaining: number;
}

export interface PolicyPreference {
  objective: string;
  discourseShape: string;
  intervention: string;
  refinementVeto?: boolean;
  vetoReason?: string;
  allowCompoundMove?: boolean;
  intentHint?: string;
  confidence?: number;
  riskFlags?: string[];
}

export interface PhaseGateResult {
  legal: boolean;
  reason?: string;
}

export interface FinalizeDecision {
  defaultFinalize: boolean;
  canPropose: boolean;
}

export interface ArbitratedTurnPlan {
  action: "coach" | "one_refinement_turn" | "finalize" | "blocked";
  objective: string;
  discourseShape: string;
  intervention: string;
  allowCompoundMove: boolean;
  intentHint: string;
  primaryGap?: PrimaryGap;
  decrementVetoBudget?: boolean;
  fatigueOverride?: boolean;
  questionTemplate?: string;
}

export interface PlanAdherenceReport {
  adherent: boolean;
  finalizeAdherence: boolean;
  primaryGapAdherence: boolean;
  questionCountAdherence: boolean;
  noHiddenRefinement: boolean;
  overallAdherence: number;
  violations: string[];
  enforcedBy?: "llm" | "generateCoachTurn" | "guardrail";
}

export interface RuntimeModeTransition {
  from: CoachRuntimeMode;
  to: CoachRuntimeMode;
  reason: string;
}

export interface RuntimeHealth {
  adherenceFailures: number;
  arbitrationConflict: boolean;
  traceConsistent: boolean;
  hardFailure: boolean;
}

export interface ModelCapabilityProfile {
  modelId: string;
  planAdherenceTier: "high" | "medium" | "low";
  abstractionTolerance: "full" | "reduced" | "minimal";
  maxIntentHintLength: number;
  requiresHardFinalizeEnforcement: boolean;
  adherenceThreshold: number;
}

export interface CoachTurnTrace {
  schemaVersion: number;
  turnId: string;
  timestamp: string;
  subStep: string;
  runtimeMode: CoachRuntimeMode;
  rawSignals: SemanticFeatures;
  discourseSignals: DiscourseSignals;
  coachingSignals: CoachingSignals;
  fatigueSignals: EngagementSignals;
  phaseGate?: PhaseGateResult;
  finalizeDecision?: FinalizeDecision;
  policyPreference?: PolicyPreference;
  arbitrationDecision: ArbitratedTurnPlan;
  modelProfile?: string;
  generatedPlan: ArbitratedTurnPlan;
  adherenceReport?: PlanAdherenceReport;
  runtimeTransition?: RuntimeModeTransition;
  llmRaw?: { mirror?: string; coachQuestion?: string };
  guardrailActions?: string[];
  finalOutput?: { mirror: string; coachQuestion: string };
}

export interface RuntimeCoachOutput {
  mirror: string;
  coachQuestion: string;
  plan: ArbitratedTurnPlan;
  trace: CoachTurnTrace;
  runtimeMode: CoachRuntimeMode;
}
