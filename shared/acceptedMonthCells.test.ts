import { describe, expect, it } from "vitest";
import { buildAcceptedMonthCells } from "./acceptedMonthCells";

describe("buildAcceptedMonthCells", () => {
  it("marks accepted days and pads to full weeks (Mon-first)", () => {
    // 2026-09-01 is Tuesday → one leading pad (Mon)
    const map = new Map<string, Array<{ id: number }>>([
      ["2026-09-15", [{ id: 1 }, { id: 2 }]],
      ["2026-09-20", [{ id: 3 }]],
    ]);
    const cells = buildAcceptedMonthCells(2026, 9, map, "2026-09-15");
    expect(cells.length % 7).toBe(0);
    expect(cells[0]).toMatchObject({ ymd: null, day: null }); // Mon pad
    const day1 = cells.find((c) => c.day === 1);
    expect(day1?.ymd).toBe("2026-09-01");
    expect(day1?.hasAccepted).toBe(false);
    const day15 = cells.find((c) => c.day === 15);
    expect(day15).toMatchObject({
      ymd: "2026-09-15",
      hasAccepted: true,
      count: 2,
      isToday: true,
    });
    const day20 = cells.find((c) => c.day === 20);
    expect(day20).toMatchObject({ hasAccepted: true, count: 1, isToday: false });
  });
});
