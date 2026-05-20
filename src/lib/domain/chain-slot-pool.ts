/**
 * Phase B：从聊天收集各环候选，再物化为 baseline slots（历史回放不抢写主槽）。
 */
import {
  buildSlotsFromChat,
  isExampleSentence,
  isLinkSentence,
  isReasonSentence,
  isTooSimilarToClaim,
  isWeakExampleSentence,
} from "./chain-scaffold";

function examplePickScore(text: string, body: WorkshopBodyKey): number {
  const t = text.trim();
  let score = t.length >= 30 ? 2 : 1;
  if (/校企|合作|实习机会|岗位实训/.test(t)) score += 4;
  if (/公司|技术栈|编程|c\+\+|计算机/.test(t)) score += 2;
  if (/比如|例如/.test(t)) score += 1;
  if (isWeakExampleSentence(t, body)) score -= 5;
  return score;
}
import {
  accumulateDimensionTexts,
  userMessages,
} from "./essay-substance";
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

  const claim =
    body === "body1" ? state.s2?.body1Point : state.s2?.body2Point;

  for (const msg of stage2UserMessages(state, body)) {
    const sents = [
      msg.trim(),
      ...msg.split(/[。；;\n]/).map((s) => s.trim()).filter((s) => s.length >= 8),
    ];
    for (const sent of sents) {
      const key = sent.slice(0, 48);
      if (isLinkSentence(sent, body, claim) && !seen.link.has(key)) {
        seen.link.add(key);
        pool.link.push(sent);
      }
      if (isExampleSentence(sent, body) && !seen.example.has(key)) {
        seen.example.add(key);
        pool.example.push(sent);
      }
      if (isReasonSentence(sent, body) && !seen.reason.has(key)) {
        seen.reason.add(key);
        pool.reason.push(sent);
      }
    }
  }
  return pool;
}

/** 每环取最长且不与它环完全同文的候选 */
export function materializeSlotsFromPool(
  pool: RingCandidatePool,
  claim?: string,
  body: WorkshopBodyKey = "body1",
): ParagraphSlots {
  const pick = (arr: string[], avoid: string[]) => {
    const sorted = [...arr].sort((a, b) => b.length - a.length);
    for (const t of sorted) {
      if (!avoid.some((a) => a.trim() === t.trim())) return t;
    }
    return sorted[0] ?? "";
  };
  const reason = pick(pool.reason, []);
  const example = pickExampleSlot(body, ...pool.example) ?? pick(pool.example, [reason]);
  const linkPick = pick(pool.link, [reason, example]);
  const link =
    linkPick &&
    isLinkSentence(linkPick, body, claim) &&
    !isTooSimilarToClaim(linkPick, claim, body)
      ? linkPick
      : "";
  const slots: ParagraphSlots = {};
  if (claim?.trim()) slots.claim = claim;
  if (reason) slots.reason = reason;
  if (example) slots.example = example;
  if (link && link !== reason && link !== example) slots.link = link;
  return slots;
}

function pickExampleSlot(
  body: WorkshopBodyKey,
  ...candidates: (string | null | undefined)[]
): string | undefined {
  const valid = candidates
    .map((c) => c?.trim())
    .filter((c): c is string => !!c);
  return [...valid].sort(
    (a, b) => examplePickScore(b, body) - examplePickScore(a, body),
  )[0];
}

function pickRingSlot(
  text: string | null | undefined,
  ring: ChainRing,
  body: WorkshopBodyKey,
  claim?: string,
): string | undefined {
  const t = text?.trim();
  if (!t) return undefined;
  if (ring === "reason" && isReasonSentence(t, body)) return t;
  if (ring === "example" && isExampleSentence(t, body)) return t;
  if (ring === "link" && isLinkSentence(t, body, claim)) return t;
  return undefined;
}

/** Stage1 学术侧已说过的机制句，供 Body2 工作坊作 Reason 种子 */
function seedBody2ReasonFromStage1(state: SessionState): string | undefined {
  const { academicText } = accumulateDimensionTexts(userMessages(state));
  if (!academicText || academicText.length < 12) return undefined;
  const sents = [
    academicText,
    ...academicText.split(/[。；;\n]/).map((s) => s.trim()).filter((s) => s.length >= 10),
  ];
  let best = { text: "", score: 0 };
  for (const sent of sents) {
    if (!isReasonSentence(sent, "body2") || isLinkSentence(sent, "body2")) continue;
    const score = sent.length >= 20 ? 2 : 1;
    if (score > best.score) best = { text: sent.trim(), score };
  }
  return best.text || undefined;
}

function stripInvalidLink(
  slots: ParagraphSlots,
  body: WorkshopBodyKey,
): ParagraphSlots {
  const claim = slots.claim?.trim();
  const link = slots.link?.trim();
  if (!link) return slots;
  if (!isLinkSentence(link, body, claim) || isTooSimilarToClaim(link, claim, body)) {
    const { link: _drop, ...rest } = slots;
    return rest;
  }
  return slots;
}

/** Stage2 baseline = 审题 claim + 候选池物化（seg 只补强，不覆盖池里已齐的环） */
export function buildChainBaselineSlots(
  state: SessionState,
  body: WorkshopBodyKey,
  segSlots?: ParagraphSlots,
): ParagraphSlots {
  const fromChat = buildSlotsFromChat(state, body);
  const pool = collectRingCandidates(state, body);
  const claimRaw =
    body === "body1" ? state.s2?.body1Point : state.s2?.body2Point;
  const claimNorm =
    fromChat.claim ?? fromChat.elaboration ?? claimRaw ?? undefined;
  const fromPool = materializeSlotsFromPool(pool, claimNorm, body);

  const merged: ParagraphSlots = {
    claim: claimNorm,
    reason:
      pickRingSlot(fromChat.reason, "reason", body) ??
      pickRingSlot(fromPool.reason, "reason", body),
    example:
      pickExampleSlot(body, fromChat.example, fromPool.example) ??
      pickRingSlot(fromPool.example, "example", body),
    link:
      pickRingSlot(fromChat.link, "link", body, claimNorm) ??
      pickRingSlot(fromPool.link, "link", body, claimNorm),
  };

  if (body === "body2" && !merged.reason?.trim()) {
    const seeded = seedBody2ReasonFromStage1(state);
    if (seeded) merged.reason = seeded;
  }

  if (segSlots) {
    const segReason = pickRingSlot(segSlots.reason, "reason", body);
    if (segReason) merged.reason = segReason;
    const segEx = pickRingSlot(segSlots.example, "example", body);
    if (segEx) {
      merged.example = pickExampleSlot(body, merged.example, segEx) ?? segEx;
    }
    const segLink = pickRingSlot(segSlots.link, "link", body, claimNorm);
    if (segLink) merged.link = segLink;
    if (segSlots.claim?.trim()) merged.claim = segSlots.claim;
  }

  return stripInvalidLink(merged, body);
}
