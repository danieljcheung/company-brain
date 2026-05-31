"use client";

import { useRouter } from "next/navigation";

import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function SiteHeader() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/front-door/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-2 h-4" />
      <div className="flex-1" />
      <Button variant="outline" size="sm" onClick={() => void handleLogout()}>
        Log out
      </Button>
      <ModeToggle />
    </header>
  );
}
