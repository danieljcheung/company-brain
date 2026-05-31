import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { AppLayoutWrapper } from "@/components/app-layout-wrapper";
import "./globals.css";

export const metadata: Metadata = {
  title: "Popup Pearl Dashboard",
  description: "Operator workbench for Popup Pearl inbox, standards, and operations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <AppLayoutWrapper>{children}</AppLayoutWrapper>
        </ThemeProvider>
      </body>
    </html>
  );
}
