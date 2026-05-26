"use client";

import { useEffect, useState } from "react";
import { useWritingStore } from "@/lib/store/writing-store";

/** Avoid SSR/hydration crash from zustand persist (localStorage). */
export function ClientGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      await useWritingStore.persist.rehydrate();

      // 「确认写入」按钮已下线（auto-advance 替代）。旧 persist 可能停在
      // S3_2 / mode=feedback / pendingSentence 已设 / sentenceState=stabilizable|refine_needed，
      // 但因为按钮没了而无法推进。这里主动触发一次 confirm，让链路自然续上。
      const { state, confirmSentence } = useWritingStore.getState();
      const stuck =
        !!state &&
        state.subStep === "S3_2_MODULE" &&
        state.s3?.mode === "feedback" &&
        !!state.s3?.pendingSentence &&
        (state.coachContext?.sentenceState === "stabilizable" ||
          state.coachContext?.sentenceState === "refine_needed");

      if (stuck) {
        try {
          await confirmSentence();
        } catch {
          /* 接力失败不阻塞 UI；用户仍可手动写下一句。 */
        }
      }

      setReady(true);
    })();
  }, []);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-50 text-sm text-stone-500">
        加载中…
      </div>
    );
  }

  return <>{children}</>;
}
