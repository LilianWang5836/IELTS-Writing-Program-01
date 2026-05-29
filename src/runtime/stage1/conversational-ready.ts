import { detectFrustration } from "@/runtime/shared/frustration";

export type ConversationalReadiness = {
  conversationalReady: boolean;
  userConfirmed: boolean;
  frustrationDetected: boolean;
  repeatedAnswerDetected: boolean;
};

/** Short confirmations that don't introduce new content. */
const CONFIRM_RE =
  /^(好的|好|可以|行|嗯|对|ok|okay|yes)([，。,.!！\s]*.*)?$/i;

export function detectUserConfirmation(text?: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length > 12) return false;
  if (/好处|具体|展开|比如/.test(t)) return false;
  return CONFIRM_RE.test(t);
}

/**
 * Generic repeated-answer detection: normalize then check substring overlap.
 * Not topic-specific — works for any subject.
 */
export function detectRepeatedSemanticAnswer(prev: string, next: string): boolean {
  const normalize = (s: string) => s.replace(/[，。,.!?！？\s]/g, "").trim();
  const a = normalize(prev);
  const b = normalize(next);
  if (a.length < 4 || b.length < 4) return false;
  if (a.length > b.length + 10 || b.length > a.length + 10) return false;
  return a.includes(b) || b.includes(a);
}

export function buildConversationalReadiness(input: {
  semanticComplete: boolean;
  latestUserMessage?: string;
  prevUserMessage?: string;
}): ConversationalReadiness {
  const userConfirmed = detectUserConfirmation(input.latestUserMessage);
  const frustrationDetected = detectFrustration(input.latestUserMessage);
  const repeatedAnswerDetected = !!(
    input.prevUserMessage &&
    input.latestUserMessage &&
    !userConfirmed &&
    !frustrationDetected &&
    detectRepeatedSemanticAnswer(input.prevUserMessage, input.latestUserMessage)
  );

  const conversationalReady =
    input.semanticComplete &&
    (userConfirmed || frustrationDetected || repeatedAnswerDetected);

  return { conversationalReady, userConfirmed, frustrationDetected, repeatedAnswerDetected };
}
