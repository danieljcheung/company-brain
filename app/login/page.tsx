"use client";

import type { Route } from "next";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const next = safeNextPath(searchParams.get("next"));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/front-door/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(
          response.status === 401
            ? "That password did not match. Try again."
            : data?.error ?? "Login failed.",
        );
        return;
      }
      router.replace(next as Route);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LoginShell
      error={error}
      password={password}
      submitting={submitting}
      onPasswordChange={setPassword}
      onSubmit={handleSubmit}
    />
  );
}

function LoginShell({
  error,
  password = "",
  submitting = false,
  onPasswordChange,
  onSubmit,
}: {
  error?: string | null;
  password?: string;
  submitting?: boolean;
  onPasswordChange?: (value: string) => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(206,177,149,0.22),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(206,177,149,0.16),transparent_30%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(206,177,149,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.07),transparent_30%)]" />
      <Card className="relative w-full max-w-md overflow-hidden border-border bg-card shadow-xl shadow-black/10 dark:shadow-black/50">
        <div className="h-1 bg-[#CEB195]" />
        <CardHeader className="space-y-4 pb-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-sidebar-primary text-xl font-semibold text-sidebar-primary-foreground shadow-sm">
            PP
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
              Popup Pearl Operations
            </p>
            <CardTitle className="text-3xl font-semibold tracking-tight">
              Popup Pearl Dashboard
            </CardTitle>
            <CardDescription className="text-balance text-sm leading-6 text-muted-foreground">
              Sign in to review inbox drafts, catering details, and approved operating knowledge.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="front-door-password">
                Password
              </label>
              <Input
                id="front-door-password"
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "front-door-error" : "front-door-helper"}
                placeholder="Shared dashboard password"
                value={password}
                onChange={(event) => onPasswordChange?.(event.target.value)}
                autoFocus
                className="h-11 border-input bg-background focus-visible:ring-[#CEB195]/45"
              />
            </div>
            {error ? (
              <p id="front-door-error" role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              className="h-11 w-full bg-primary font-semibold text-primary-foreground shadow-lg shadow-black/10 hover:bg-primary/90 dark:bg-[#CEB195] dark:text-black dark:hover:bg-[#bea181]"
              type="submit"
              disabled={submitting || !password.trim()}
            >
              {submitting ? "Opening dashboard..." : "Enter dashboard"}
            </Button>
          </form>
          <p id="front-door-helper" className="text-center text-xs leading-5 text-muted-foreground">
            Session is remembered on this browser.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
