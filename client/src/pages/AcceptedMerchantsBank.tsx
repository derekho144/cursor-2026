import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Download, Printer, Building2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("zh-HK", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function fmtMoney(n: number, currency = "HKD"): string {
  return `${currency} ${n.toLocaleString("en-HK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeCsv(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function AcceptedMerchantsBank() {
  const [, setLocation] = useLocation();
  const currentYear = new Date().getFullYear();
  const [yearFilter, setYearFilter] = useState<string>("all");

  const queryInput = useMemo(() => {
    if (yearFilter === "all") return undefined;
    if (yearFilter.startsWith("from-")) return { fromYear: parseInt(yearFilter.replace("from-", ""), 10) };
    return { year: parseInt(yearFilter, 10) };
  }, [yearFilter]);

  const { data, isLoading, error } = trpc.quotes.acceptedMerchants.useQuery(queryInput);

  function downloadCsv() {
    if (!data) return;
    const headers = [
      "No.",
      "Merchant / Company",
      "Contact Person",
      "Email",
      "Phone",
      "Accepted Quotes",
      "Total Amount (HKD)",
      "First Accepted",
      "Last Accepted",
      "Main Services",
    ];
    const lines = [
      headers.join(","),
      ...data.merchants.map((m, i) =>
        [
          i + 1,
          escapeCsv(m.merchantName),
          escapeCsv(m.contactName),
          escapeCsv(m.email),
          escapeCsv(m.phone),
          m.quoteCount,
          m.totalAmount.toFixed(2),
          escapeCsv(fmtDate(m.firstAcceptedAt)),
          escapeCsv(fmtDate(m.lastAcceptedAt)),
          escapeCsv(m.serviceTypes.join(" / ")),
        ].join(",")
      ),
    ];
    const bom = "\uFEFF";
    const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `JD-Studio-Accepted-Merchants-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 print:space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap print:hidden">
          <div>
            <button
              onClick={() => setLocation("/quotes")}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
            >
              <ArrowLeft className="h-4 w-4" /> 返回報價單
            </button>
            <div style={{ fontSize: "0.6rem", letterSpacing: "0.2em", color: "#d4a843", textTransform: "uppercase", marginBottom: "6px" }}>
              Banking Document
            </div>
            <h1 className="text-2xl font-light flex items-center gap-2">
              <Building2 className="h-6 w-6" style={{ color: "#d4a843" }} />
              已接受商家名單（銀行用）
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              由已接受報價單匯總，供開戶／銀行查核客戶往來用途。可列印或下載 CSV。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger className="w-[150px]" style={{ background: "#111", border: "1px solid rgba(212,168,67,0.2)" }}>
                <SelectValue placeholder="年份" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部年份</SelectItem>
                <SelectItem value={`from-${currentYear - 2}`}>近 3 年</SelectItem>
                {[0, 1, 2, 3].map((i) => {
                  const y = currentYear - i;
                  return (
                    <SelectItem key={y} value={String(y)}>
                      {y} 年
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <button
              onClick={downloadCsv}
              disabled={!data?.merchants.length}
              className="flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-40"
              style={{ border: "1px solid rgba(212,168,67,0.4)", color: "#d4a843", borderRadius: 2 }}
            >
              <Download className="h-4 w-4" />
              下載 CSV
            </button>
            <button
              onClick={() => window.print()}
              disabled={!data?.merchants.length}
              className="flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-40"
              style={{ background: "#d4a843", color: "#0a0a0a", fontWeight: 600, borderRadius: 2 }}
            >
              <Printer className="h-4 w-4" />
              列印／另存 PDF
            </button>
          </div>
        </div>

        {/* Printable document */}
        <div
          id="bank-merchant-print"
          className="rounded-sm overflow-hidden print:shadow-none"
          style={{ background: "#fff", color: "#111", border: "1px solid rgba(212,168,67,0.25)" }}
        >
          <div className="p-6 sm:p-8 print:p-0">
            <div className="flex justify-between items-start gap-4 border-b border-neutral-200 pb-4 mb-4">
              <div>
                <div className="text-xl font-semibold tracking-wide">JD Studio HK</div>
                <div className="text-sm text-neutral-600 mt-1">Commercial Photography &amp; Video Production</div>
              </div>
              <div className="text-right text-sm text-neutral-600">
                <div>Generated: {data ? fmtDate(data.generatedAt) : "—"}</div>
                <div className="mt-1 font-medium text-neutral-800">Accepted Merchant List for Banking</div>
                <div>已接受報價商家名單（銀行開戶用途）</div>
              </div>
            </div>

            <p className="text-sm text-neutral-700 mb-4 leading-relaxed">
              本公司（JD Studio HK）現提供以下客戶／商家名單。名單僅包含系統內狀態為
              「已接受（Accepted）」之報價單所對應之往來客戶，供銀行作開立帳戶／了解業務往來參考。
            </p>

            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : error ? (
              <p className="text-sm text-red-600">載入失敗：{error.message}</p>
            ) : !data?.merchants.length ? (
              <p className="text-sm text-neutral-500">暫無已接受報價商家資料。</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
                  <div className="bg-neutral-50 p-3 rounded">
                    <div className="text-neutral-500 text-xs">商家數目</div>
                    <div className="text-lg font-semibold">{data.merchantCount}</div>
                  </div>
                  <div className="bg-neutral-50 p-3 rounded">
                    <div className="text-neutral-500 text-xs">已接受報價</div>
                    <div className="text-lg font-semibold">{data.acceptedQuoteCount}</div>
                  </div>
                  <div className="bg-neutral-50 p-3 rounded col-span-2">
                    <div className="text-neutral-500 text-xs">累計成交金額</div>
                    <div className="text-lg font-semibold">{fmtMoney(data.grandTotal)}</div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs sm:text-sm border-collapse">
                    <thead>
                      <tr className="bg-neutral-100 text-left">
                        <th className="border border-neutral-300 px-2 py-2 w-10">#</th>
                        <th className="border border-neutral-300 px-2 py-2">商家／公司名稱</th>
                        <th className="border border-neutral-300 px-2 py-2">聯絡人</th>
                        <th className="border border-neutral-300 px-2 py-2">電郵</th>
                        <th className="border border-neutral-300 px-2 py-2">電話</th>
                        <th className="border border-neutral-300 px-2 py-2 text-right">次數</th>
                        <th className="border border-neutral-300 px-2 py-2 text-right">累計金額</th>
                        <th className="border border-neutral-300 px-2 py-2">首次</th>
                        <th className="border border-neutral-300 px-2 py-2">最近</th>
                        <th className="border border-neutral-300 px-2 py-2">服務</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.merchants.map((m, i) => (
                        <tr key={`${m.merchantName}-${i}`} className="align-top">
                          <td className="border border-neutral-300 px-2 py-1.5">{i + 1}</td>
                          <td className="border border-neutral-300 px-2 py-1.5 font-medium">{m.merchantName}</td>
                          <td className="border border-neutral-300 px-2 py-1.5">{m.contactName}</td>
                          <td className="border border-neutral-300 px-2 py-1.5 break-all">{m.email || "—"}</td>
                          <td className="border border-neutral-300 px-2 py-1.5 whitespace-nowrap">{m.phone || "—"}</td>
                          <td className="border border-neutral-300 px-2 py-1.5 text-right">{m.quoteCount}</td>
                          <td className="border border-neutral-300 px-2 py-1.5 text-right whitespace-nowrap">
                            {fmtMoney(m.totalAmount, m.currency)}
                          </td>
                          <td className="border border-neutral-300 px-2 py-1.5 whitespace-nowrap">{fmtDate(m.firstAcceptedAt)}</td>
                          <td className="border border-neutral-300 px-2 py-1.5 whitespace-nowrap">{fmtDate(m.lastAcceptedAt)}</td>
                          <td className="border border-neutral-300 px-2 py-1.5">{m.serviceTypes.join("、")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-8 pt-4 border-t border-neutral-200 text-sm text-neutral-700 space-y-4">
                  <p>
                    本人確認以上資料乃根據本公司報價／客戶管理系統之「已接受」記錄整理，供銀行參考。
                  </p>
                  <div className="grid sm:grid-cols-2 gap-8 pt-6">
                    <div>
                      <div className="border-b border-neutral-400 h-10 mb-2" />
                      <div>授權簽署 Authorized Signature</div>
                    </div>
                    <div>
                      <div className="border-b border-neutral-400 h-10 mb-2" />
                      <div>日期 Date</div>
                    </div>
                  </div>
                  <p className="text-xs text-neutral-500 pt-4">
                    Document ID: JD-ACCEPTED-MERCHANTS · Source: quotes.status = accepted · jdsys.biz
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { margin: 12mm; size: A4 landscape; }
          body { background: white !important; }
          aside, nav, [data-sidebar], .print\\:hidden { display: none !important; }
          #bank-merchant-print {
            border: none !important;
            box-shadow: none !important;
          }
          #bank-merchant-print table { font-size: 9px !important; }
        }
      `}</style>
    </DashboardLayout>
  );
}
