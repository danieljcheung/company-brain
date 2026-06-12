"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type SafetyStatusProps = {
  variant?: "block" | "pill";
};

export function SafetyStatus({ variant = "block" }: SafetyStatusProps) {
  const [active, setActive] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  useEffect(() => {
    async function loadStatus() {
      try {
        const res = await fetch("/api/inbox/safety-mode");
        if (res.ok) {
          const data = (await res.json()) as { active: boolean; envWritesAllowed: boolean };
          setActive(data.active);
        }
      } catch (err) {
        console.error("Failed to load safety mode status:", err);
      } finally {
        setLoading(false);
      }
    }
    loadStatus();
  }, []);

  async function handleToggle() {
    setActionLoading(true);
    try {
      const res = await fetch("/api/inbox/safety-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      if (res.ok) {
        const data = (await res.json()) as { active: boolean; envWritesAllowed: boolean };
        setActive(data.active);
        // Refresh the page so that all components adapt to the new safety cookie state
        window.location.reload();
      }
    } catch (err) {
      console.error("Failed to toggle safety mode:", err);
    } finally {
      setActionLoading(false);
    }
  }

  const modeLabel = active ? "Safety Mode: ON" : "Safety Mode: OFF";
  const statusDescription = active
    ? "Gmail sends and Zoho invoice writes are blocked."
    : "Live Gmail sends and Zoho invoice writes are enabled.";

  if (loading) {
    return (
      <div className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium text-muted-foreground bg-muted/20">
        <Loader2 className="size-3.5 animate-spin" />
        <span>Loading safety status...</span>
      </div>
    );
  }

  if (variant === "pill") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:px-3 ${
              active
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/20"
                : "bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20 animate-pulse"
            }`}
            aria-label={statusDescription}
            title={statusDescription}
          >
            {active ? (
              <ShieldCheck className="size-3.5 shrink-0" />
            ) : (
              <ShieldAlert className="size-3.5 shrink-0" />
            )}
            <span className="whitespace-nowrap">{active ? "Safety ON" : "Safety OFF"}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          align="end"
          side="bottom"
          sideOffset={8}
          className="w-72 max-w-[calc(100vw-2rem)] p-3 text-left bg-popover text-popover-foreground border shadow-md"
        >
          <div className="grid gap-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">{modeLabel}</span>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={handleToggle}
                  className={`inline-flex items-center justify-center rounded px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                    active
                      ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      : "bg-emerald-600 text-white hover:bg-emerald-700"
                  }`}
                >
                  {actionLoading ? (
                    <Loader2 className="size-3 animate-spin mr-1" />
                  ) : null}
                  {active ? "Disable" : "Enable"}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground leading-normal">
                {statusDescription} Tap the status pill, then use this control to change mode.
              </p>
            </div>
            <dl className="grid gap-2 border-t pt-2 text-[10px] text-muted-foreground uppercase font-medium">
              <div className="flex items-center justify-between">
                <dt>Gmail Outgoing Sends</dt>
                <dd className={active ? "text-emerald-600" : "text-destructive font-semibold"}>
                  {active ? "BLOCKED" : "ENABLED"}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Zoho Invoice Writes</dt>
                <dd className={active ? "text-emerald-600" : "text-destructive font-semibold"}>
                  {active ? "BLOCKED" : "ENABLED"}
                </dd>
              </div>
            </dl>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <section
      className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${
        active
          ? "bg-emerald-500/5 border-emerald-500/20"
          : "bg-destructive/5 border-destructive/20"
      }`}
      aria-label="Settings and safety status"
    >
      <div>
        <div className="flex items-center gap-2">
          {active ? (
            <ShieldCheck className="size-4 text-emerald-600" />
          ) : (
            <ShieldAlert className="size-4 text-destructive" />
          )}
          <strong className={active ? "text-emerald-800" : "text-destructive"}>
            {modeLabel}
          </strong>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {statusDescription}
        </p>
      </div>
      <div className="flex items-center gap-4">
        <dl className="hidden sm:flex gap-5 text-[10px] text-muted-foreground uppercase font-medium">
          <div className="grid gap-0.5">
            <dt>Gmail Sends</dt>
            <dd className={active ? "text-emerald-600 font-semibold" : "text-destructive font-bold"}>
              {active ? "BLOCKED" : "LIVE"}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt>Zoho Writes</dt>
            <dd className={active ? "text-emerald-600 font-semibold" : "text-destructive font-bold"}>
              {active ? "BLOCKED" : "LIVE"}
            </dd>
          </div>
        </dl>
        <button
          type="button"
          disabled={actionLoading}
          onClick={handleToggle}
          className={`inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-semibold shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
            active
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/95"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
          }`}
        >
          {actionLoading ? (
            <Loader2 className="size-3 animate-spin mr-1.5" />
          ) : null}
          {active ? "Turn Off Safety Mode" : "Turn On Safety Mode"}
        </button>
      </div>
    </section>
  );
}
