"use client";

import { useWritingStore } from "@/lib/store/writing-store";

export function StageProgress() {
  const { state } = useWritingStore();
  if (!state) return null;

  const stages = [
    { n: 1, done: state.markers.stage1Pass, label: "审题立意" },
    { n: 2, done: state.markers.stage2Pass, label: "论证链条" },
    { n: 3, done: state.subStep === "COMPLETED", label: "逐句写作" },
  ];

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs text-stone-500">
      {stages.map((s, i) => (
        <span key={s.n} className="flex items-center gap-2">
          {i > 0 && <span className="text-stone-300">→</span>}
          <span
            className={
              s.done
                ? "font-medium text-emerald-600"
                : state.stage === s.n
                  ? "font-medium text-sky-600"
                  : ""
            }
          >
            Stage {s.n} {s.label}
            {s.done ? " ✓" : ""}
          </span>
        </span>
      ))}
    </div>
  );
}
