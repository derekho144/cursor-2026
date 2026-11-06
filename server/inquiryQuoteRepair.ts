export function hasOrphanedQuoteLink(
  quoteId: number | null | undefined,
  linkedQuote: unknown,
): boolean {
  return quoteId != null && linkedQuote == null;
}
