export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/[.!?。！？]+/).filter((s) => s.trim().length > 3).length || 1;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function validateUserSentence(text: string): { ok: boolean; error?: string } {
  const t = text.trim();
  if (!t) return { ok: false, error: "请输入内容" };
  if (wordCount(t) > 45) return { ok: false, error: "请控制在 45 词以内（一句）" };
  if (countSentences(t) > 2) return { ok: false, error: "请一次只写一句话" };
  return { ok: true };
}
