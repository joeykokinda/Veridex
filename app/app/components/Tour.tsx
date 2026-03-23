"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

export type TourStep = {
  targetId: string;
  title: string;
  body: string;
  position?: "top" | "bottom" | "left" | "right";
  action?: { label: string; href?: string; onClick?: () => void };
  nextLabel?: string;
};

const STORAGE_KEY = "veridex_tour_done";

export function useTour(steps: TourStep[], autoStart = false) {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (!autoStart) return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem(STORAGE_KEY)) return;
    // small delay so DOM is ready
    const t = setTimeout(() => setStep(0), 600);
    return () => clearTimeout(t);
  }, [autoStart]);

  const next = useCallback(() => {
    setStep(s => {
      if (s === null) return null;
      if (s >= steps.length - 1) {
        if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, "1");
        return null;
      }
      return s + 1;
    });
  }, [steps.length]);

  const skip = useCallback(() => {
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, "1");
    setStep(null);
  }, []);

  const restart = useCallback(() => {
    if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
    setStep(0);
  }, []);

  return { step, next, skip, restart, active: step !== null };
}

export function TourBubble({ steps, step, next, skip }: {
  steps: TourStep[];
  step: number | null;
  next: () => void;
  skip: () => void;
}) {
  const router = useRouter();
  const [pos, setPos] = useState({ top: 0, left: 0, arrowDir: "top" as string });

  useEffect(() => {
    if (step === null) return;
    const s = steps[step];
    if (!s) return;

    const el = document.getElementById(s.targetId);
    if (!el) {
      // fallback to center-bottom
      setPos({ top: window.innerHeight - 220, left: window.innerWidth / 2 - 160, arrowDir: "none" });
      return;
    }

    el.classList.add("tour-highlight");
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    const rect = el.getBoundingClientRect();
    const bubbleW = 320;
    const bubbleH = 170;
    const gap = 14;

    let top = 0, left = 0, arrowDir = "top";
    const dir = s.position || "bottom";

    if (dir === "bottom") {
      top = rect.bottom + gap;
      left = rect.left + rect.width / 2 - bubbleW / 2;
      arrowDir = "top";
    } else if (dir === "top") {
      top = rect.top - bubbleH - gap;
      left = rect.left + rect.width / 2 - bubbleW / 2;
      arrowDir = "bottom";
    } else if (dir === "right") {
      top = rect.top + rect.height / 2 - bubbleH / 2;
      left = rect.right + gap;
      arrowDir = "left";
    } else {
      top = rect.top + rect.height / 2 - bubbleH / 2;
      left = rect.left - bubbleW - gap;
      arrowDir = "right";
    }

    // clamp to viewport
    left = Math.max(12, Math.min(left, window.innerWidth - bubbleW - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - bubbleH - 12));

    setPos({ top, left, arrowDir });

    return () => el.classList.remove("tour-highlight");
  }, [step, steps]);

  if (step === null) return null;
  const s = steps[step];
  if (!s) return null;

  const isLast = step === steps.length - 1;

  return (
    <>
      {/* Backdrop dimmer — doesn't block clicks */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 999,
        background: "rgba(0,0,0,0.45)", pointerEvents: "none",
      }} />

      {/* Bubble */}
      <div style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: 320,
        zIndex: 1000,
        background: "#0f0f11",
        border: "1px solid rgba(16,185,129,0.4)",
        borderRadius: 12,
        padding: "18px 20px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(16,185,129,0.15)",
        pointerEvents: "all",
      }}>
        {/* Step counter */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: "#10b981" }}>
            {step + 1} / {steps.length}
          </span>
          <button onClick={skip} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
        </div>

        {/* Content */}
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{s.title}</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.65, marginBottom: 16 }}>{s.body}</div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {s.action && (
            <button
              onClick={() => {
                if (s.action?.href) router.push(s.action.href);
                if (s.action?.onClick) s.action.onClick();
                next();
              }}
              style={{ flex: 1, background: "#10b981", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 700, color: "#000", cursor: "pointer" }}
            >
              {s.action.label}
            </button>
          )}
          <button
            onClick={next}
            style={{ flex: s.action ? 0 : 1, background: s.action ? "transparent" : "#10b981", border: s.action ? "1px solid rgba(255,255,255,0.15)" : "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: s.action ? 400 : 700, color: s.action ? "rgba(255,255,255,0.5)" : "#000", cursor: "pointer" }}
          >
            {isLast ? "Done ✓" : (s.nextLabel || "Next →")}
          </button>
        </div>
      </div>

      <style>{`
        .tour-highlight {
          position: relative;
          z-index: 1000;
          box-shadow: 0 0 0 3px #10b981, 0 0 20px rgba(16,185,129,0.3) !important;
          border-radius: 8px;
        }
      `}</style>
    </>
  );
}
