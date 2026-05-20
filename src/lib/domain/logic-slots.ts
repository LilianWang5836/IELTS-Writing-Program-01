import type { LogicFill, ParagraphSlot, ParagraphSlots } from "./types";

export function slotsFromExtracted(
  extracted?: Record<string, unknown>,
  key?: "body1Logic" | "body2Logic",
): ParagraphSlots | undefined {
  if (!key || !extracted) return undefined;
  const logic = extracted[key] as LogicFill | undefined;
  return logic?.slots;
}

export function formatSlotsBlock(
  label: string,
  slots?: ParagraphSlots,
  missing?: ParagraphSlot[],
): string[] {
  if (!slots && !missing?.length) return [];
  const lines = [label];
  const order: ParagraphSlot[] = [
    "claim",
    "reason",
    "elaboration",
    "support",
    "example",
    "link",
  ];
  const names: Record<ParagraphSlot, string> = {
    claim: "论点",
    reason: "原因",
    elaboration: "论述",
    support: "支撑",
    example: "举例",
    link: "扣题",
  };
  let any = false;
  for (const k of order) {
    const v = slots?.[k]?.trim();
    if (v) {
      lines.push(`  ${names[k]}：${v}`);
      any = true;
    }
  }
  if (!any) lines.push("  （尚未结构化）");
  if (missing?.length) {
    lines.push(`  论证仍缺：${missing.map((m) => names[m] ?? m).join("、")}`);
  }
  return lines;
}
