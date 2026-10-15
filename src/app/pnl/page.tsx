import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard";

export const metadata: Metadata = {
  title: "PnL replay · Birdeye Replayer",
  description: "Replay any Solana wallet's trades and audit its PnL, built on the Birdeye Data API.",
};

export default function PnlPage() {
  return <Dashboard />;
}
