import type { Metadata } from "next";
import { Studio } from "@/components/studio";

export const metadata: Metadata = {
  title: "Chart replay · Birdeye Replayer",
  description: "Replay any Solana token's chart with big trades, smart money, KOLs, snipers and the dev marked, built on the Birdeye Data API.",
};

export default function ChartPage() {
  return <Studio />;
}
