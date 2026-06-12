"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { BookOpen, Inbox, Settings, UploadCloud } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const navItems: Array<{
  title: string;
  href: Route;
  icon: typeof Inbox;
}> = [
  { title: "Inbox", href: "/", icon: Inbox },
  { title: "Company Brain", href: "/brain", icon: BookOpen },
  { title: "Ingestion", href: "/ingestion", icon: UploadCloud },
  { title: "Settings", href: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { state } = useSidebar();

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  PP
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Popup Pearl</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Operations
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu className="px-2" data-tutorial="app-sidebar-nav">
          {navItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={pathname === item.href}
                tooltip={item.title}
              >
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="px-4 py-3 border-t border-sidebar-border/30">
        {state === "expanded" ? (
          <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground/60 select-none">
            <div className="font-medium text-foreground/80">Popup Pearl Dashboard</div>
            <div>v1.0.5 · Production</div>
          </div>
        ) : (
          <div className="flex justify-center text-[9px] text-muted-foreground/50 select-none font-medium">
            v1.0
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
