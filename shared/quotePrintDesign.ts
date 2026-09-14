/**
 * Shared typography and geometry for the browser download page and the
 * server-rendered email attachment. Keep these values together so a change to
 * either output cannot silently create a second quotation visual language.
 */
export const QUOTE_PRINT_DESIGN = {
  pageWidthPx: 794,
  contentHorizontalPaddingPx: 40,
  fontFamily: "'Helvetica Neue', Helvetica, Arial, 'NotoSansCJK', sans-serif",
} as const;
