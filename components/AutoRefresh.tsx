"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const t = setInterval(() => { if (active) router.refresh(); }, intervalMs);
    return () => { active = false; clearInterval(t); };
  }, [router, intervalMs]);
  return null;
}
