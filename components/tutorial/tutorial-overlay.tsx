"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTutorial } from "./tutorial-provider";

type TargetBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const bubbleWidth = 320;
const viewportPadding = 16;

function bubblePosition(target: TargetBox | null, placement: string | undefined): CSSProperties {
  if (typeof window === "undefined" || !target) {
    return {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  const maxLeft = Math.max(viewportPadding, window.innerWidth - bubbleWidth - viewportPadding);
  const centeredLeft = target.left + target.width / 2 - bubbleWidth / 2;
  const left = Math.min(maxLeft, Math.max(viewportPadding, centeredLeft));
  const maxTop = Math.max(viewportPadding, window.innerHeight - 220);
  const top = Math.min(maxTop, Math.max(viewportPadding, target.top));
  const gap = 12;

  if (placement === "top") {
    const bottom = Math.max(viewportPadding, window.innerHeight - target.top + gap);
    return { left, bottom };
  }

  if (placement === "left") {
    return {
      left: Math.min(maxLeft, Math.max(viewportPadding, target.left - bubbleWidth - gap)),
      top,
    };
  }

  if (placement === "right") {
    return {
      left: Math.min(maxLeft, Math.max(viewportPadding, target.left + target.width + gap)),
      top,
    };
  }

  const belowTop = target.top + target.height + gap;
  if (belowTop > window.innerHeight - 220 && target.top > 240) {
    return { left, bottom: Math.max(viewportPadding, window.innerHeight - target.top + gap) };
  }

  return {
    left,
    top: Math.min(maxTop, Math.max(viewportPadding, belowTop)),
  };
}

export function TutorialOverlay() {
  const {
    active,
    nextStep,
    previousStep,
    routePending,
    skipTutorial,
    step,
    stepCount,
    stepIndex,
  } = useTutorial();
  const [targetBox, setTargetBox] = useState<TargetBox | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const frameRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);

  const clearScheduledWork = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  const measureTarget = useCallback(() => {
    if (!active || !step || routePending) return;

    const element = document.querySelector<HTMLElement>(`[data-tutorial="${step.target}"]`);
    if (!element) {
      setTargetBox(null);
      setTargetMissing(true);
      return;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      setTargetBox(null);
      setTargetMissing(true);
      return;
    }

    setTargetBox({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
    setTargetMissing(false);
  }, [active, routePending, step]);

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return;

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      measureTarget();
    });
  }, [measureTarget]);

  useEffect(() => {
    clearScheduledWork();
    setTargetBox(null);
    setTargetMissing(false);

    if (!active || !step || routePending) return;

    const element = document.querySelector<HTMLElement>(`[data-tutorial="${step.target}"]`);
    if (!element) {
      setTargetMissing(true);
      return;
    }

    element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    settleTimerRef.current = window.setTimeout(measureTarget, 80);

    return clearScheduledWork;
  }, [active, clearScheduledWork, measureTarget, routePending, step]);

  useEffect(() => {
    if (!active || routePending) return;

    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("orientationchange", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);

    return () => {
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("orientationchange", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      clearScheduledWork();
    };
  }, [active, clearScheduledWork, routePending, scheduleMeasure]);

  if (!active || !step) return null;

  const style = bubblePosition(targetMissing || routePending ? null : targetBox, step.placement);
  const highlightStyle = targetBox && !targetMissing && !routePending
    ? {
        left: targetBox.left - 6,
        top: targetBox.top - 6,
        width: targetBox.width + 12,
        height: targetBox.height + 12,
      }
    : undefined;
  const isLast = stepIndex === stepCount - 1;
  const statusBody = routePending
    ? "Opening the right page for this step."
    : targetMissing
      ? step.missingBody ?? "This step is not visible right now. You can continue or come back after the related content is available."
      : step.body;

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <div className="absolute inset-0 bg-background/35" />
      {highlightStyle ? (
        <div
          aria-hidden="true"
          className="absolute rounded-xl border-2 border-blue-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.32)] transition-[left,top,width,height] duration-150"
          style={highlightStyle}
        />
      ) : null}
      <section
        aria-live="polite"
        className={cn(
          "pointer-events-auto fixed grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[320px] gap-3 overflow-y-auto rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl",
          (targetMissing || routePending) && "text-center",
        )}
        style={style}
      >
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Step {stepIndex + 1} of {stepCount}
          </p>
          <h2 className="text-base font-semibold leading-tight">{step.title}</h2>
          <p className="text-sm leading-5 text-muted-foreground">{statusBody}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={skipTutorial}>
            Skip
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={stepIndex === 0} onClick={previousStep}>
              Back
            </Button>
            <Button size="sm" disabled={routePending} onClick={nextStep}>
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
