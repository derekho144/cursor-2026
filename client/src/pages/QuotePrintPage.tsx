/**
 * QuotePrintPage.tsx
 * A dedicated print-optimized page for quote PDFs.
 * Uses browser native window.print() — no backend Chrome/Puppeteer needed.
 * Layout matches the reference PDF template exactly.
 * Accessible at /print/quote/:id (protected, requires login)
 */
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { SERVICE_LABELS } from "@/lib/serviceLabels";
import { LOGO_BASE64_URL } from "@/lib/logoBase64";

// Use inlined base64 logo to avoid CDN dependency - prevents print crash when CDN is slow
const LOGO_URL = LOGO_BASE64_URL;

const TERMS = [
  "訂金不設退款 · Deposit is non-refundable",
  "報價單有效期 14 天 · Quotation valid for 14 days from date of issue",
  "付款後方可確認預約 · Booking confirmed upon receipt of deposit",
  "因不可抗力（如天災、疫情等）導致拍攝無法進行，雙方可協商改期，但不能取消 · In case of force majeure (e.g. natural disaster, pandemic), rescheduling may be arranged by mutual agreement, but cancellation is not permitted",
  "本報價單經客戶簽署或以任何形式確認後，即視為具有法律效力之合約，雙方均受其條款約束 · This quotation, once signed or confirmed by the client in any form, constitutes a legally binding contract and both parties shall be bound by its terms.",
];

function formatDate(d: string | Date) {
  return new Date(d)
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase();
}

function formatMoney(val: string | number) {
  const n = Number(val);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function QuotePrintPage() {
  const params = useParams<{ id: string }>();
  const quoteId = parseInt(params.id);
  const isReceipt = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("type") === "receipt";
  const docLabel = isReceipt ? "RECEIPT" : "QUOTATION";

  const { data: quote, isLoading, error } = trpc.quotes.getById.useQuery(
    { id: quoteId },
    { enabled: !isNaN(quoteId) }
  );

  const printTriggered = useRef(false);

  // Logo is now inlined as base64 - no CDN dependency, so we can print as soon as data is ready
  useEffect(() => {
    if (quote && !printTriggered.current) {
      printTriggered.current = true;
      // Short delay to allow React to finish rendering
      const timer = setTimeout(() => {
        window.print();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [quote]);

  if (isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#fff" }}>
        <div style={{ textAlign: "center" }}>
          <Loader2 style={{ width: 32, height: 32, margin: "0 auto 16px", color: "#999" }} className="animate-spin" />
          <p style={{ color: "#999", fontSize: 14 }}>Loading quotation...</p>
        </div>
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#fff" }}>
        <p style={{ color: "#e53e3e" }}>Quotation not found.</p>
      </div>
    );
  }

  const items = (quote as any).items || [];
  const llmDescription = (quote as any).llmDescription || "";
  const signatureData = (quote as any).signatureData || null;
  const signedByName = (quote as any).signedByName || "";
  const signedAt = (quote as any).signedAt || null;


  // Styles
  const S = {
    page: {
      background: "#fff",
      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      color: "#222",
      maxWidth: 794,
      margin: "0 auto",
      padding: "0 0 32px 0",
      boxSizing: "border-box" as const,
    },
    // Header — dark style matching QuoteDetail (compact)
    headerRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      background: "#111111",
      padding: "16px 32px 14px 32px",
      WebkitPrintColorAdjust: "exact" as const,
      printColorAdjust: "exact" as const,
    },
    headerLeft: { flex: 1 },
    headerRight: { textAlign: "right" as const, minWidth: 200 },
    logo: { width: 90, height: "auto", display: "block", marginBottom: 8 },
    contactLabel: { fontSize: 7, letterSpacing: "0.18em", textTransform: "uppercase" as const, color: "#777", display: "inline-block", width: 38 },
    contactValue: { fontSize: 9.5, color: "#cccccc" },
    contactRow: { lineHeight: 1.8 },
    docLabel: { fontSize: 7.5, letterSpacing: "0.25em", textTransform: "uppercase" as const, color: "#888888", marginBottom: 5 },
    quoteNumber: { fontSize: 28, fontWeight: 300, color: "#ffffff", lineHeight: 1 },
    dateLine: { fontSize: 9, color: "#888888", marginTop: 7, letterSpacing: "0.12em", textTransform: "uppercase" as const },
    dateLabel: { marginRight: 8 },
    // Client / Service section
    clientServiceRow: {
      display: "flex",
      borderBottom: "1px solid #e8e8e8",
      marginBottom: 0,
    },
    clientCol: { flex: 1, paddingRight: 16, paddingTop: 10, paddingBottom: 10 },
    serviceCol: { flex: 1, paddingLeft: 16, paddingTop: 10, paddingBottom: 10, borderLeft: "1px solid #f0f0f0" },
    sectionLabel: { fontSize: 7, letterSpacing: "0.18em", textTransform: "uppercase" as const, color: "#aaa", marginBottom: 5, fontWeight: 500 },
    clientName: { fontSize: 13, fontWeight: 700, color: "#111", marginBottom: 2 },
    clientDetail: { fontSize: 9.5, color: "#555", marginBottom: 1 },
    serviceType: { fontSize: 12, color: "#222", fontWeight: 400, marginBottom: 2 },
    // Description
    descBlock: {
      borderLeft: "2px solid #ddd",
      background: "#fafafa",
      padding: "7px 10px",
    },
    // Table
    tableWrap: { marginTop: 0, borderBottom: "1px solid #e8e8e8" },
    tableHeader: {
      display: "flex",
      borderBottom: "1px solid #ddd",
      borderTop: "1px solid #ddd",
      background: "#f7f7f7",
      padding: "5px 0",
    },
    thQty: { width: 40, textAlign: "center" as const, fontSize: 7, letterSpacing: "0.15em", textTransform: "uppercase" as const, color: "#888", fontWeight: 500 },
    thDesc: { flex: 1, fontSize: 7, letterSpacing: "0.15em", textTransform: "uppercase" as const, color: "#888", fontWeight: 500 },
    thPrice: { width: 95, textAlign: "right" as const, fontSize: 7, letterSpacing: "0.15em", textTransform: "uppercase" as const, color: "#888", fontWeight: 500 },
    thAmount: { width: 95, textAlign: "right" as const, fontSize: 7, letterSpacing: "0.15em", textTransform: "uppercase" as const, color: "#888", fontWeight: 500, paddingRight: 4 },
    // Totals
    totalsRow: { display: "flex", justifyContent: "flex-end", padding: "10px 0 6px 0" },
    totalAmountLabel: { fontSize: 8, letterSpacing: "0.15em", textTransform: "uppercase" as const, color: "#aaa", marginBottom: 4 },
    totalAmountValue: { fontSize: 22, fontWeight: 300, color: "#111", letterSpacing: "-0.02em" },
    // Notes
    notesBlock: {
      border: "1px solid #e8e8e8",
      borderRadius: 2,
      padding: "7px 10px",
      margin: "8px 0",
    },
    // Payment
    paymentSection: { marginTop: 10, marginBottom: 8 },
    paymentGrid: { display: "flex", gap: 16, alignItems: "flex-start" },
    paymentCol: { flex: 1 },
    paymentTitle: { fontSize: 7, letterSpacing: "0.15em", textTransform: "uppercase" as const, color: "#aaa", fontWeight: 500, marginBottom: 5 },
    paymentRow: { display: "flex", gap: 6, marginBottom: 2, fontSize: 9.5 },
    paymentRowLabel: { fontSize: 7.5, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "#aaa", width: 48, flexShrink: 0, paddingTop: 1 },
    paymentRowValue: { color: "#222", fontWeight: 500 },
    contactBox: {
      background: "#1a1a1a",
      color: "#fff",
      padding: "10px 14px",
      minWidth: 120,
      WebkitPrintColorAdjust: "exact" as const,
      printColorAdjust: "exact" as const,
    },
    contactBoxLabel: { fontSize: 6.5, letterSpacing: "0.15em", textTransform: "uppercase" as const, color: "#888", marginBottom: 5 },
    contactBoxName: { fontSize: 18, fontWeight: 400, color: "#fff", marginBottom: 3 },
    contactBoxPhone: { fontSize: 10, color: "#ccc" },
    contactBoxAccent: { width: 20, height: 2, background: "#c9a84c", marginTop: 6 },
    // Terms
    termsSection: { marginTop: 8, marginBottom: 8 },
    // Footer
    footer: {
      borderTop: "1px solid #e8e8e8",
      paddingTop: 7,
      display: "flex",
      justifyContent: "space-between",
      marginTop: 10,
    },
    footerText: { fontSize: 8, color: "#bbb", letterSpacing: "0.1em" },
    // Signature
    sigSection: { marginTop: 10, borderTop: "1px solid #e8e8e8", paddingTop: 10 },
  };

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: #f0f0f0;
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        @media print {
          html, body {
            background: #fff !important;
            width: 210mm;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print { display: none !important; }
          .print-page {
            max-width: 100% !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          @page { size: A4; margin: 0; }
        }
        @media screen {
          .print-page {
            background: #fff;
            box-shadow: 0 4px 24px rgba(0,0,0,0.12);
            margin: 60px auto 40px;
          }
        }
        .header-divider {
          width: 100%;
          height: 1px;
          background: #444444;
          margin: 14px 0 10px;
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Screen-only toolbar */}
      <div className="no-print" style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        background: "#1a1a1a", padding: "10px 20px",
        display: "flex", alignItems: "center", gap: "12px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)"
      }}>
        <button
          onClick={() => window.print()}
          style={{
            background: "#c9a84c", color: "#fff", border: "none",
            padding: "8px 20px", borderRadius: "4px", cursor: "pointer",
            fontWeight: 600, fontSize: "13px", letterSpacing: "0.05em"
          }}
        >
          ⬇ Download / Print PDF
        </button>
        <button
          onClick={() => window.close()}
          style={{
            background: "transparent", color: "#888", border: "1px solid #444",
            padding: "8px 16px", borderRadius: "4px", cursor: "pointer",
            fontSize: "13px"
          }}
        >
          ✕ Close
        </button>
        <span style={{ color: "#666", fontSize: "12px", marginLeft: "8px" }}>
          {quote.quoteNumber} — Click "Download / Print PDF" then choose "Save as PDF"
        </span>
      </div>

      {/* Main print content */}
      <div className="print-page" style={S.page}>

        {/* ── HEADER (dark, matching QuoteDetail) ── */}
        <div style={S.headerRow}>
          {/* Left: Logo + contact */}
          <div style={S.headerLeft}>
            <img src={LOGO_URL} alt="JD STUDIO" style={S.logo} />
            <div style={{ fontSize: 11, lineHeight: 2.0 }}>
              <div style={S.contactRow}>
                <span style={S.contactLabel}>TEL</span>
                <span style={S.contactValue}>+852 9153 1976</span>
              </div>
              <div style={S.contactRow}>
                <span style={S.contactLabel}>EMAIL</span>
                <span style={S.contactValue}>info.exposurehk@gmail.com</span>
              </div>
              <div style={S.contactRow}>
                <span style={S.contactLabel}>WEB</span>
                <span style={S.contactValue}>www.jdstudiohk.com</span>
              </div>
            </div>
          </div>
          {/* Right: Doc type + number + date */}
          <div style={S.headerRight}>
            <div style={S.docLabel}>{docLabel}</div>
            <div style={S.quoteNumber}>{quote.quoteNumber}</div>
            <div className="header-divider" />
            <div style={S.dateLine}>
              DATE &nbsp; {formatDate(quote.createdAt)}
            </div>
          </div>
        </div>
        {/* Gold gradient divider below header */}
        <div style={{ height: 1, background: "linear-gradient(to right, #d4a843, rgba(212,168,67,0.1), transparent)", WebkitPrintColorAdjust: "exact" as const, printColorAdjust: "exact" as const }} />
        {/* Content wrapper with padding */}
        <div style={{ padding: "0 40px" }}>

        {/* ── CLIENT & SERVICE ── */}
        <div style={S.clientServiceRow}>
          <div style={S.clientCol}>
            <div style={S.sectionLabel}>PREPARED FOR</div>
            <div style={S.clientName}>{quote.clientCompany || quote.clientName}</div>
            {quote.clientCompany && (
              <div style={S.clientDetail}>{quote.clientName}</div>
            )}
            {quote.clientPhone && <div style={S.clientDetail}>{quote.clientPhone}</div>}
            {quote.clientEmail && <div style={S.clientDetail}>{quote.clientEmail}</div>}
          </div>
          <div style={S.serviceCol}>
            <div style={S.sectionLabel}>SERVICE DETAILS</div>
            <div style={S.serviceType}>{SERVICE_LABELS[quote.serviceType] ?? quote.serviceType}</div>
            {quote.shootingDate && <div style={S.clientDetail}>Date: {quote.shootingDate}</div>}
            {quote.shootingLocation && <div style={S.clientDetail}>Location: {quote.shootingLocation}</div>}
          </div>
        </div>



        {/* ── ITEMS TABLE ── */}
        <div style={S.tableWrap}>
          {/* Table header */}
          <div style={S.tableHeader}>
            <div style={S.thQty}>QTY</div>
            <div style={S.thDesc}>DESCRIPTION</div>
            <div style={S.thPrice}>UNIT PRICE</div>
            <div style={S.thAmount}>AMOUNT</div>
          </div>

          {/* Item rows */}
          {items.map((item: any, idx: number) => {
            const isIncluded = item.isIncluded || Number(item.unitPrice) === 0;
            return (
              <div key={idx} style={{
                display: "flex",
                borderBottom: "1px solid #eeeeee",
                padding: "7px 0",
                background: idx % 2 === 0 ? "#ffffff" : "#f7f7f7",
                WebkitPrintColorAdjust: "exact" as const,
                printColorAdjust: "exact" as const,
              }}>
                <div style={{ width: 48, textAlign: "center", fontSize: 10.5, color: "#444" }}>
                  {Number(item.quantity)}
                </div>
                <div style={{ flex: 1, fontSize: 10.5, color: "#111", fontWeight: 500, wordBreak: "break-word", paddingRight: 8 }}>
                  {item.description.split("\n").map((line: string, i: number) => (
                    <span key={i}>{line}{i < item.description.split("\n").length - 1 && <br />}</span>
                  ))}
                </div>
                <div style={{ width: 110, textAlign: "right", fontSize: 10.5, color: "#444", whiteSpace: "nowrap" }}>
                  {isIncluded ? <em style={{ fontStyle: "italic", color: "#888" }}>Included</em> : formatMoney(item.unitPrice)}
                </div>
                <div style={{ width: 110, textAlign: "right", fontSize: 10.5, color: "#222", whiteSpace: "nowrap", paddingRight: 4 }}>
                  {isIncluded ? <em style={{ fontStyle: "italic", color: "#888" }}>Included</em> : formatMoney(item.amount)}
                </div>
              </div>
            );
          })}

          {/* Extra meta rows (equipment / team / delivery) — match email & PDFKit */}
          {([
            quote.equipment ? { label: "LIGHTING & EQUIPMENT", value: quote.equipment } : null,
            (quote as any).team ? { label: "TEAM", value: (quote as any).team } : null,
            (quote as any).deliveryMethod ? { label: "PHOTO DELIVERY METHOD", value: (quote as any).deliveryMethod } : null,
          ].filter(Boolean) as { label: string; value: string }[]).map((row, i) => {
            const idx = items.length + i;
            return (
              <div key={`extra-${i}`} style={{
                display: "flex",
                borderBottom: "1px solid #eeeeee",
                padding: "7px 0",
                background: idx % 2 === 0 ? "#ffffff" : "#f7f7f7",
                WebkitPrintColorAdjust: "exact" as const,
                printColorAdjust: "exact" as const,
              }}>
                <div style={{ flex: 1, fontSize: 7.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#888", fontWeight: 600, paddingLeft: 8 }}>
                  {row.label}
                </div>
                <div style={{ flex: 1, fontSize: 10.5, color: "#333", textAlign: "right", paddingRight: 4 }}>
                  {row.value}
                </div>
              </div>
            );
          })}

        </div>

        {/* ── TOTALS ── */}
        <div style={S.totalsRow}>
          <div style={{ textAlign: "right", paddingRight: 4, minWidth: 200 }}>
            {Number(quote.discountAmount) > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 32, marginBottom: 4 }}>
                <span style={{ fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "#aaa" }}>SUBTOTAL</span>
                <span style={{ fontSize: 10.5, color: "#555" }}>HKD {formatMoney(quote.subtotal)}</span>
              </div>
            )}
            {Number(quote.discountAmount) > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 32, marginBottom: 4 }}>
                <span style={{ fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "#aaa" }}>
                  DISCOUNT{Number((quote as any).discountPercent) > 0 ? ` (${Number((quote as any).discountPercent)}%)` : ""}
                </span>
                <span style={{ fontSize: 10.5, color: "#555" }}>- HKD {formatMoney(quote.discountAmount)}</span>
              </div>
            )}
            <div style={{ borderTop: "1px solid #ccc", paddingTop: 8, marginTop: 4 }}>
              <div style={S.totalAmountLabel}>TOTAL AMOUNT</div>
              <div style={S.totalAmountValue}>${formatMoney(quote.total)}</div>
            </div>
            {/* Deposit — supports both percent and fixed amount modes */}
            {(() => {
              const depositMode = (quote as any).depositMode ?? "percent";
              const depositPct = Number((quote as any).depositPercent ?? 0);
              const depositFixedAmt = Number((quote as any).depositFixedAmount ?? 0);
              const hasDeposit = depositMode === "fixed" ? depositFixedAmt > 0 : depositPct > 0;
              if (!hasDeposit) return null;
              const depositAmt = depositMode === "fixed"
                ? depositFixedAmt
                : Number(quote.total) * depositPct / 100;
              const netAmt = Number(quote.total) - depositAmt;
              const isFullPayment = depositAmt >= Number(quote.total);
              const depositLabel = depositMode === "fixed"
                ? `DEPOSIT (HKD ${depositAmt.toLocaleString('en-HK')})`
                : `DEPOSIT (${depositPct}%)`;
              return (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 32, marginTop: 8 }}>
                    <span style={{ fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "#aaa" }}>
                      {depositLabel}
                    </span>
                    <span style={{ fontSize: 10.5, color: "#111", fontWeight: 600 }}>
                      HKD {depositAmt.toLocaleString('en-HK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  {!isFullPayment && (
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 32, marginTop: 4 }}>
                      <span style={{ fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "#aaa" }}>NET PAYMENT</span>
                      <span style={{ fontSize: 10.5, color: "#555" }}>
                        HKD {netAmt.toLocaleString('en-HK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {/* ── NOTES ── */}
        {quote.notes && (
          <div style={S.notesBlock}>
            <div style={{ ...S.sectionLabel, marginBottom: 6 }}>NOTES</div>
            <p style={{ fontSize: 10.5, color: "#444", lineHeight: 1.7 }}>
              {quote.notes.split("\n").map((line: string, i: number) => (
                <span key={i}>{line}{i < quote.notes!.split("\n").length - 1 && <br />}</span>
              ))}
            </p>
          </div>
        )}

        {/* ── PAYMENT DETAIL ── */}
        <div style={S.paymentSection}>
          <div style={{ ...S.sectionLabel, marginBottom: 12 }}>PAYMENT DETAIL</div>
          <div style={S.paymentGrid}>
            {/* Bank Transfer */}
            <div style={S.paymentCol}>
              <div style={S.paymentTitle}>BANK TRANSFER</div>
              <div style={S.paymentRow}>
                <span style={S.paymentRowLabel}>PAYEE</span>
                <span style={S.paymentRowValue}>JD STUDIO Limited</span>
              </div>
              <div style={S.paymentRow}>
                <span style={S.paymentRowLabel}>BANK</span>
                <span style={S.paymentRowValue}>Standard Chartered Bank (Hong Kong) Ltd</span>
              </div>
              <div style={S.paymentRow}>
                <span style={S.paymentRowLabel}>ACCOUNT</span>
                <span style={S.paymentRowValue}>44796326072</span>
              </div>
              <div style={S.paymentRow}>
                <span style={S.paymentRowLabel}>REF</span>
                <span style={{ ...S.paymentRowValue, fontWeight: 700 }}>{quote.quoteNumber}</span>
              </div>
            </div>
            {/* FPS */}
            <div style={S.paymentCol}>
              <div style={S.paymentTitle}>FPS 轉數快</div>
              <div style={S.paymentRow}>
                <span style={S.paymentRowLabel}>PAYEE</span>
                <span style={S.paymentRowValue}>HUI MAN HO</span>
              </div>
              <div style={S.paymentRow}>
                <span style={S.paymentRowLabel}>電話</span>
                <span style={S.paymentRowValue}>95131188</span>
              </div>
              <div style={S.paymentRow}>
                <span style={S.paymentRowLabel}>REF</span>
                <span style={{ ...S.paymentRowValue, fontWeight: 700 }}>{quote.quoteNumber}</span>
              </div>
            </div>
            {/* Contact box */}
            <div style={S.contactBox}>
              <div style={S.contactBoxLabel}>CONTACT</div>
              <div style={S.contactBoxName}>Derek</div>
              <div style={S.contactBoxPhone}>+852 9153 1976</div>
              <div style={S.contactBoxAccent} />
            </div>
          </div>
        </div>

        {/* ── TERMS & CONDITIONS ── */}
        <div style={S.termsSection}>
          <div style={{ ...S.sectionLabel, marginBottom: 10 }}>TERMS &amp; CONDITIONS</div>
          <ul style={{ paddingLeft: 18 }}>
            {TERMS.map((t, i) => (
              <li key={i} style={{ marginBottom: 5, fontSize: 9.5, color: "#444", lineHeight: 1.7 }}>{t}</li>
            ))}
          </ul>
        </div>

        {/* ── GOOGLE REVIEW SECTION ── */}
        {!isReceipt && (
          <div style={{
            marginTop: 12,
            marginBottom: 10,
            background: "#0d0d0d",
            border: "1px solid #3a2e14",
            borderRadius: 6,
            padding: "12px 16px",
            WebkitPrintColorAdjust: "exact" as const,
            printColorAdjust: "exact" as const,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ fontSize: 24, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>⭐</div>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontFamily: "'Georgia', serif",
                  fontStyle: "italic",
                  fontSize: 13,
                  color: "#e8d5a0",
                  marginBottom: 5,
                  letterSpacing: "0.02em",
                }}>Google Review</div>
                <div style={{ marginBottom: 9 }}>
                  <div style={{ fontSize: 10, color: "#ccc", lineHeight: 1.7, marginBottom: 2 }}>
                    Leave us a Google review &amp; follow our Instagram{" "}
                    <span style={{ color: "#c9a84c", fontStyle: "italic" }}>@jdstudiohk</span>
                    {" "}to enjoy a special discount on this shoot.
                  </div>
                  <div style={{ fontSize: 8.5, color: "#777", lineHeight: 1.7 }}>
                    於 Google 留下您的真實評價，並追蹤我們的 Instagram{" "}
                    <span style={{ color: "#a07830", fontStyle: "italic" }}>@jdstudiohk</span>
                    ，即可於本次攝影服務中享有特別折扣。
                  </div>
                </div>
                <div style={{
                  background: "#1a1a1a",
                  border: "1px solid #3a2e14",
                  borderRadius: 4,
                  padding: "7px 14px",
                  display: "inline-block",
                  WebkitPrintColorAdjust: "exact" as const,
                  printColorAdjust: "exact" as const,
                }}>
                  <div style={{ fontSize: 10, color: "#c9a84c", letterSpacing: "0.06em", marginBottom: 1 }}>
                    Google Review + Follow IG &nbsp;→&nbsp; 10% Discount
                  </div>
                  <div style={{ fontSize: 8.5, color: "#a07830", letterSpacing: "0.04em" }}>
                    Google 好評 + Follow IG &nbsp;→&nbsp; 10% 折扣優惠
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SIGNATURE BLOCK (only if signed) ── */}
        {signatureData && (
          <div style={S.sigSection}>
            <div style={{ ...S.sectionLabel, marginBottom: 12 }}>SIGNATURES</div>
            <div style={{ display: "flex", gap: 32 }}>
              {/* Client signature */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 7, letterSpacing: "0.18em", textTransform: "uppercase", color: "#bbb", marginBottom: 8 }}>CLIENT SIGNATURE</div>
                <div style={{ border: "1px solid #e0e0e0", borderRadius: 2, background: "#fafafa", padding: 4, marginBottom: 8, height: 80, overflow: "hidden", textAlign: "center" }}>
                  <img src={signatureData} style={{ maxWidth: "100%", maxHeight: 72, objectFit: "contain", display: "inline-block" }} alt="Client Signature" />
                </div>
                <div style={{ borderTop: "1px solid #ccc", paddingTop: 6 }}>
                  <div style={{ fontSize: 10, color: "#333", fontWeight: 500 }}>{signedByName}</div>
                  <div style={{ fontSize: 8, color: "#aaa", marginTop: 2 }}>
                    {signedAt ? formatDate(signedAt) : formatDate(new Date())}
                  </div>
                </div>
              </div>
              {/* Authorised signature */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 7, letterSpacing: "0.18em", textTransform: "uppercase", color: "#bbb", marginBottom: 8 }}>AUTHORISED SIGNATURE</div>
                <div style={{ border: "1px solid #e0e0e0", borderRadius: 2, background: "#fafafa", padding: 4, marginBottom: 8, height: 80, overflow: "hidden", textAlign: "center", lineHeight: "80px" }}>
                  <span style={{ fontFamily: "'Georgia', serif", fontSize: 26, color: "#1a1a1a", letterSpacing: "0.02em", fontStyle: "italic", verticalAlign: "middle" }}>JD Studio HK</span>
                </div>
                <div style={{ borderTop: "1px solid #ccc", paddingTop: 6 }}>
                  <div style={{ fontSize: 10, color: "#333", fontWeight: 500 }}>JD Studio HK</div>
                  <div style={{ fontSize: 8, color: "#aaa", marginTop: 2 }}>{formatDate(new Date())}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── FOOTER ── */}
        <div style={S.footer}>
          <span style={S.footerText}>JD STUDIO · HONG KONG</span>
          <span style={S.footerText}>info.exposurehk@gmail.com &nbsp;·&nbsp; www.jdstudiohk.com</span>
        </div>

        </div>{/* end content wrapper */}
      </div>
    </>
  );
}
