"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  tutorialCompletedKey,
  tutorialStepKey,
  tutorialSteps,
  type TutorialStep,
} from "./tutorial-types";
import { TutorialOverlay } from "./tutorial-overlay";

type TutorialContextValue = {
  active: boolean;
  routePending: boolean;
  step: TutorialStep | null;
  stepIndex: number;
  stepCount: number;
  startTutorial: () => void;
  restartTutorial: () => void;
  nextStep: () => void;
  previousStep: () => void;
  skipTutorial: () => void;
};

const TutorialContext = createContext<TutorialContextValue | null>(null);

function readStoredStep() {
  if (typeof window === "undefined") return 0;

  const parsed = Number(window.localStorage.getItem(tutorialStepKey));
  if (!Number.isInteger(parsed)) return 0;

  return Math.min(tutorialSteps.length - 1, Math.max(0, parsed));
}

export function TutorialProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const completed = window.localStorage.getItem(tutorialCompletedKey) === "true";
    setStepIndex(readStoredStep());
    setActive(!completed);
    setMounted(true);
  }, []);

  const step = active ? tutorialSteps[stepIndex] ?? null : null;
  const routePending = Boolean(step && pathname !== step.route);

  useEffect(() => {
    if (!mounted || !active || !step) return;

    window.localStorage.setItem(tutorialStepKey, String(stepIndex));
    if (pathname !== step.route) {
      router.push(step.route);
    }
  }, [active, mounted, pathname, router, step, stepIndex]);

  const finish = useCallback(() => {
    window.localStorage.setItem(tutorialCompletedKey, "true");
    window.localStorage.removeItem(tutorialStepKey);
    setActive(false);
    setStepIndex(0);
  }, []);

  const startTutorial = useCallback(() => {
    window.localStorage.removeItem(tutorialCompletedKey);
    setStepIndex(readStoredStep());
    setActive(true);
  }, []);

  const restartTutorial = useCallback(() => {
    window.localStorage.removeItem(tutorialCompletedKey);
    window.localStorage.setItem(tutorialStepKey, "0");
    setStepIndex(0);
    setActive(true);
    if (pathname !== tutorialSteps[0].route) {
      router.push(tutorialSteps[0].route);
    }
  }, [pathname, router]);

  const nextStep = useCallback(() => {
    const next = stepIndex + 1;
    if (next >= tutorialSteps.length) {
      finish();
      return;
    }

    window.localStorage.setItem(tutorialStepKey, String(next));
    setStepIndex(next);
    if (pathname !== tutorialSteps[next].route) {
      router.push(tutorialSteps[next].route);
    }
  }, [finish, pathname, router, stepIndex]);

  const previousStep = useCallback(() => {
    const previous = Math.max(0, stepIndex - 1);
    window.localStorage.setItem(tutorialStepKey, String(previous));
    setStepIndex(previous);
    if (pathname !== tutorialSteps[previous].route) {
      router.push(tutorialSteps[previous].route);
    }
  }, [pathname, router, stepIndex]);

  const value = useMemo<TutorialContextValue>(
    () => ({
      active,
      routePending,
      step,
      stepIndex,
      stepCount: tutorialSteps.length,
      startTutorial,
      restartTutorial,
      nextStep,
      previousStep,
      skipTutorial: finish,
    }),
    [active, finish, nextStep, previousStep, restartTutorial, routePending, startTutorial, step, stepIndex],
  );

  return (
    <TutorialContext.Provider value={value}>
      {children}
      {mounted ? <TutorialOverlay /> : null}
    </TutorialContext.Provider>
  );
}

export function useTutorial() {
  const context = useContext(TutorialContext);
  if (!context) {
    throw new Error("useTutorial must be used inside TutorialProvider");
  }
  return context;
}
