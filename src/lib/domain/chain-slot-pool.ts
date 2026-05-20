/**
 * Phase B：从聊天收集各环候选，再物化为 baseline slots（历史回放不抢写主槽）。
 */
import {
  buildSlotsFromChat,
  isExampleSentence,
  isLinkSentence,
  isReasonSentence,
} from "./chain-scaffold";
import type { ChainRing } from "./chain-turn-decision";
import { stage2UserMessages } from "./stage2-context";
import type { ParagraphSlots, SessionState, WorkshopBodyKey } from "./types";

export type RingCandidatePool = Record<ChainRing, string[]>;

export function collectRingCandidates(
  state: SessionState,
  body: WorkshopBodyKey,
): RingCandidatePool {
  const pool: RingCandidatePool = { reason: [], example: [], link: [] };
  const seen = { reason: new Set<string>(), example: new Set<string>(), link: new Set<string>() };

  for (const msg of stage2UserMessages(state)) {
    const sents = [
      msg.trim(),
      ...msg.split(/[。；;\n]/).map((s) => s.trim()).filter((s) => s.length >= 8),
    ];
    for (const sent of sents) {
      const key = sent.slice(0, 48);
      if (isReasonSentence(sent, body) && !seen.reason.has(key)) {
        seen.reason.add(key);
        pool.reason.push(sent);
      }
      if (isExampleSentence(sent, body) && !seen.example.has(key)) {
        seen.example.add(key);
        pool.example.push(sent);
      }
      if (isLinkSentence(sent, body) && !seen.link.has(key)) {
        seen.link.add(key);
        pool.link.push(sent);
      }
    }
  }
  return pool;
}

/** 每环取最长且不与它环完全同文的候选 */
export function materializeSlotsFromPool(
  pool: RingCandidatePool,
  claim?: string,
): ParagraphSlots {
  const pick = (arr: string[], avoid: string[]) => {
    const sorted = [...arr].sort((a, b) => b.length - a.length);
    for (const t of sorted) {
      if (!avoid.some((a) => a.trim() === t.trim())) return t;
    }
    return sorted[0] ?? "";
  };
  const reason = pick(pool.reason, []);
  const example = pick(pool.example, [reason]);
  const link = pick(pool.link, [reason, example]);
  const slots: ParagraphSlots = {};
  if (claim?.trim()) slots.claim = claim;
  if (reason) slots.reason = reason;
  if (example) slots.example = example;
  if (link && link !== reason && link !== example) slots.link = link;
  return slots;
}

/** Stage2 baseline = 审题 claim + 候选池物化（与 buildSlotsFromChat 取并集） */
export function buildChainBaselineSlots(
  state: SessionState,
  body: WorkshopBodyKey,
  segSlots?: ParagraphSlots,
): ParagraphSlots {
  const fromChat = buildSlotsFromChat(state, body);
  const pool = collectRingCandidates(state, body);
  const claim =
    fromChat.claim ??
    fromChat.elaboration ??
    (body === "body1" ? state.s2?.body1Point : state.s2?.body2Point);
  const fromPool = materializeSlotsFromPool(pool, claim ?? undefined);
  return {
    ...fromPool,
    ...fromChat,
    claim: fromChat.claim ?? fromPool.claim,
    reason: fromChat.reason ?? fromPool.reason,
    example: fromChat.example ?? fromPool.example,
    link: fromChat.link ?? fromPool.link,
    ...(segSlots ?? {}),
  };
}
