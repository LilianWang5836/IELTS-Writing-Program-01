/**
 * Stage 1 题目特性分流：
 *
 * 历史包袱：整个 stage1/2 substance 评估系统是为单一 demo 题（q2 「universities
 *   should provide graduates with knowledge & skills for workplace vs knowledge
 *   for its own sake」）写死的——hard-coded 关键词如「就业/技能侧」「学术/知识侧」
 *   遍布 essay-substance.ts、handoff-turn-decision.ts、paragraph-substance.ts、
 *   chain-scaffold.ts 等。一旦换题，这些字眼会污染所有用户对话。
 *
 * 短期对策（本模块）：用 questionId 白名单 + 题面语义双兜底，把题目分为两类：
 *   - "demo_employ_academic"：q2 这类大学就业 vs 学术二分题，沿用旧 employ/academic
 *     双侧追问通道（保留旧 chain/scaffold 兼容）。
 *   - "generic"：其他所有题目，走通用 LLM 驱动 brainstorm 引导，禁止注入
 *     「就业/技能」「学术/知识」等与题目无关的硬编码字眼。
 *
 * 长期目标：彻底用 sideA/sideB 通用结构替换 employ/academic，逐步把
 *   chain-scaffold/discourse 解耦出 demo 关键词。这一步留待后续迭代。
 */
import type { SessionState } from "./types";

export type Stage1TopicProfile = "demo_employ_academic" | "generic";

const DEMO_QUESTION_IDS = new Set<string>(["q2"]);

const DEMO_TOPIC_RE_KNOWLEDGE = /knowledge/i;
const DEMO_TOPIC_RE_UNI = /universit/i;
const DEMO_TOPIC_RE_WORKPLACE =
  /(workplace|skills?\s+(?:needed|for|in)\s+(?:the\s+)?(?:workplace|work|job))/i;

export function getStage1TopicProfile(state: SessionState): Stage1TopicProfile {
  if (state.questionId && DEMO_QUESTION_IDS.has(state.questionId)) {
    return "demo_employ_academic";
  }
  const topic = (state.topic ?? "").trim();
  if (
    DEMO_TOPIC_RE_UNI.test(topic) &&
    DEMO_TOPIC_RE_KNOWLEDGE.test(topic) &&
    DEMO_TOPIC_RE_WORKPLACE.test(topic)
  ) {
    return "demo_employ_academic";
  }
  return "generic";
}

export function isDemoEmployAcademicTopic(state: SessionState): boolean {
  return getStage1TopicProfile(state) === "demo_employ_academic";
}
