/**
 * Audit one wallet on one token from the terminal, with the same service the
 * web app uses: npm run audit -- <MINT> <WALLET>
 *
 * Reads BIRDEYE_API_KEY from the environment or .env.local.
 */
import { existsSync, readFileSync } from "node:fs";
import { walletReplay } from "../src/server/services/wallet-replay";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
}

const usd = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

async function main() {
  loadEnvFile(".env.local");
  const [mint, wallet] = process.argv.slice(2);
  if (!mint || !wallet) {
    console.error("Usage: npm run audit -- <MINT> <WALLET>");
    process.exit(1);
  }
  if (!process.env.BIRDEYE_API_KEY) {
    console.error("BIRDEYE_API_KEY is missing. Add it to .env.local or the environment.");
    process.exit(1);
  }

  const result = await walletReplay({ mint, wallet });
  const { row } = result;
  console.log(`\nBirdeye Replayer audit · ${wallet} on ${mint}`);
  console.log(`mode         ${result.mode}${result.mode === "sample" ? ` (${result.reason})` : ""}`);
  if (row.audit) {
    console.log(`confidence   ${row.audit.confidence}${row.audit.reasons.length ? ` · ${row.audit.reasons.join("; ")}` : ""}`);
    console.log(`events       ${row.audit.ledger.buys} buys · ${row.audit.ledger.sells} sells · ${row.audit.ledger.transfersIn + row.audit.ledger.transfersOut} transfers`);
  }
  console.log(`realized     ${usd(row.realizedUsd)}`);
  console.log(`unrealized   ${usd(row.unrealizedUsd)}`);
  console.log(`total        ${usd(row.totalUsd)}${row.audit ? ` (Birdeye WAC ${usd(row.audit.birdeyeTotalUsd)}, delta ${usd(row.audit.deltaUsd)})` : ""}`);
  console.log(`holding      ${row.holding.toLocaleString("en-US", { maximumFractionDigits: 4 })}`);
  console.log(`\nBirdeye usage: ${result.usage.requests} requests · ${result.usage.cu.toLocaleString()} CU · ${(result.elapsedMs / 1_000).toFixed(1)}s`);
  for (const endpoint of result.usage.endpoints) {
    console.log(`  ${endpoint.path.padEnd(34)} ${String(endpoint.requests).padStart(4)} req  ${String(endpoint.cu).padStart(6)} CU`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
