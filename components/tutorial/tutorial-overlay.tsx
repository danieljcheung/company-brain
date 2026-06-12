"use client";

import { useCallback, useEffect, useState } from "react";

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function bubblePosition(target: TargetBox | null, placement: string | undefined) {
  if (typeof window === "undefined" || !target) {
    return {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  const maxLeft = Math.max(viewportPadding, window.innerWidth - bubbleWidth - viewportPadding);
  const preferredLeft = target.left + target.width / 2 - bubbleWidth / 2;
  const left = clamp(preferredLeft, viewportPadding, maxLeft);
  const gap = 12;
  const side = placement ?? "bottom";

  if (side === "top") {
    return { left, bottom: Math.max(viewportPadding, window.innerHeight - target.top + gap) };
  }
  if (side === "left") {
    return {
      left: clamp(target.left - bubbleWidth - gap, viewportPadding, maxLeft),
      top: clamp(target.top, viewportPadding, window.innerHeight - viewportPadding),
    };
  }
  if (side === "right") {
    return {
      left: clamp(target.left + target.width + gap, viewportPadding, maxLeft),
      top: clamp(target.top, viewportPadding, window.innerHeight - viewportPadding),
    };
  }

  return {
    left,
    top: clamp(target.top + target.height + gap, viewportPadding, window.innerHeight - viewportPadding),
  };
}

export function TutorialOverlay() {
  const {
    active,
    nextStep,
    previousStep,
    skipTutorial,
    step,
    stepCount,
    stepIndex,
  } = useTutorial();
  const [targetBox, setTargetBox] = useState<TargetBox | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);

  const updateTarget = useCallback(() => {
    if (!active || !step) return;
    const element = document.querySelector<HTMLElement>(`[data-tutorial="${step.target}"]`);
    if (!element) {
      setTargetBox(null);
      setTargetMissing(true);
      return;
    }

    element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    window.setTimeout(() => {
      const rect = element.getBoundingClientRect();
      setTargetBox({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
      setTargetMissing(false);
    }, 180);
  }, [active, step]);

  useEffect(() => {
    updateTarget();
  }, [updateTarget]);

  useEffect(() => {
    if (!active) return;
    window.addEventListener("resize", updateTarget);
    window.addEventListener("orientationchange", updateTarget);
    window.addEventListener("scroll", updateTarget, true);
    return () => {
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("orientationchange", updateTarget);
      window.removeEventListener("scroll", updateTarget, true);
    };
  }, [active, updateTarget]);

  if (!active || !step) return null;

  const style = bubblePosition(targetMissing ? null : targetBox, step.placement);
  const highlightStyle = targetBox
    ? {
        left: targetBox.left - 6,
        top: targetBox.top - 6,
        width: targetBox.width + 12,
        height: targetBox.height + 12,
      }
    : undefined;
  const isLast = stepIndex === stepCount - 1;

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <div className="absolute inset-0 bg-background/45 backdrop-blur-[1px]" />
      {highlightStyle ? (
        <div
          aria-hidden="true"
          className="absolute rounded-xl border-2 border-blue-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] transition-all"
          style={highlightStyle}
        />
      ) : null}
      <section
        aria-live="polite"
        className={cn(
          "pointer-events-auto fixed grid w-[calc(100vw-2rem)] max-w-[320px] gap-3 rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl",
          targetMissing && "text-center",
        )}
        style={style}
      >
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Step {stepIndex + 1} of {stepCount}
          </p>
          <h2 className="text-base font-semibold leading-tight">{step.title}</h2>
          <p className="text-sm leading-5 text-muted-foreground">
            {targetMissing ? "This step is not visible on the current screen. Use Next or navigate with the sidebar to continue. " : ""}
            {step.body}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={skipTutorial}>
            Skip
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={stepIndex === 0} onClick={previousStep}>
              Back
            </Button>
            <Button size="sm" onClick={nextStep}>
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
