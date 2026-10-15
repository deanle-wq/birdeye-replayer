/**
 * A ticker as the UI prints it after its own "$": some tokens put the "$" in
 * the symbol itself ("$WIF"), which would otherwise read "$$WIF".
 */
export function cleanSymbol(symbol: string | null | undefined): string | undefined {
  const cleaned = symbol?.trim().replace(/^\$+/, "").trim();
  return cleaned || undefined;
}
