import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { DESIGN_CSS_VARIABLES } from "@/lib/design-system";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "Birdeye Replayer · Birdeye Data",
  description: "Replay any Solana token's chart or any wallet's PnL as a shareable video, built entirely on the Birdeye Data API.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" style={DESIGN_CSS_VARIABLES as CSSProperties}>
      <head>
        <link rel="preload" href="/brand/fonts/Geist-VariableFont_wght.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
      </head>
      <body>
        <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
