/** Unified frustration detection — single source of truth. */
export const FRUSTRATION_RE =
  /看不懂|不懂你的|不清楚|不明白|已经说|已经回答|不是已经|说得很清楚|什么意思|别绕|听不懂|重复问/i;

export function detectFrustration(text?: string): boolean {
  if (!text) return false;
  return FRUSTRATION_RE.test(text);
}
