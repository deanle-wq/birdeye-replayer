import { redirect } from "next/navigation";
import { FeaturePicker } from "@/components/feature-picker";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Feature first. A wallet link can only mean a PnL replay, so it skips the picker. */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const pick = (key: string) => (typeof params[key] === "string" ? params[key].trim() : "");
  const wallet = pick("wallet");
  const mint = pick("mint");
  if (SOLANA_ADDRESS.test(wallet)) {
    const query = new URLSearchParams({ wallet, ...(SOLANA_ADDRESS.test(mint) ? { mint } : {}) });
    redirect(`/pnl?${query}`);
  }
  return <FeaturePicker mint={SOLANA_ADDRESS.test(mint) ? mint : undefined} />;
}
