/** Pure month-grid builder for the dashboard accepted calendar (Monday-first). */
export function buildAcceptedMonthCells(
  year: number,
  month: number,
  acceptedByDate: Map<string, Array<{ id: number }>>,
  todayYmd: string
) {
  const first = new Date(year, month - 1, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const out: Array<{
    ymd: string | null;
    day: number | null;
    hasAccepted: boolean;
    count: number;
    isToday: boolean;
  }> = [];

  for (let i = 0; i < startPad; i++) {
    out.push({ ymd: null, day: null, hasAccepted: false, count: 0, isToday: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ymd = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const list = acceptedByDate.get(ymd);
    out.push({
      ymd,
      day: d,
      hasAccepted: Boolean(list?.length),
      count: list?.length ?? 0,
      isToday: ymd === todayYmd,
    });
  }
  while (out.length % 7 !== 0) {
    out.push({ ymd: null, day: null, hasAccepted: false, count: 0, isToday: false });
  }
  return out;
}
