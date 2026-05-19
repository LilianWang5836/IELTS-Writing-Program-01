/** gemini-2.5-pro 会消耗「思考」token，易导致 completion_tokens=0 + finish_reason=length */
export function isHeavyThinkingModel(model: string): boolean {
  return /gemini-2\.5-pro/i.test(model);
}

export function outputTokenBudget(model: string): number {
  return isHeavyThinkingModel(model) ? 8192 : 2048;
}

/** 教练 JSON 回复用 flash 更稳；pro 易吃满 thinking 额度 */
export function fallbackFlashModel(model: string): string {
  if (isHeavyThinkingModel(model)) return "gemini-2.5-flash";
  if (/gemini-2\.5/i.test(model)) return "gemini-2.5-flash";
  return "gemini-2.0-flash";
}
