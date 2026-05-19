"use client";

import { useEffect, useState } from "react";
import { useWritingStore } from "@/lib/store/writing-store";

/** Avoid SSR/hydration crash from zustand persist (localStorage). */
export function ClientGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void useWritingStore.persist.rehydrate();
    setReady(true);
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
