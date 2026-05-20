import type { ParagraphSlot } from "./types";

export const SLOT_LABELS_ORDER: ParagraphSlot[] = [
  "claim",
  "reason",
  "elaboration",
  "support",
  "example",
  "link",
];

const LABELS: Record<ParagraphSlot, string> = {
  claim: "论点",
  reason: "原因",
  elaboration: "论述",
  support: "支撑",
  example: "举例",
  link: "扣题",
};

export function slotLabel(key: ParagraphSlot): string {
  return LABELS[key];
}
