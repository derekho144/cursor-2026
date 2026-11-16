import { describe, expect, it } from "vitest";
import { computeJustifiedLayout } from "./justifiedLayout";

describe("computeJustifiedLayout", () => {
  it("packs mixed aspect ratios into rows that fill the container", () => {
    const items = [
      { id: "1", width: 1000, height: 1500, src: "a" },
      { id: "2", width: 1500, height: 1000, src: "b" },
      { id: "3", width: 1000, height: 1000, src: "c" },
      { id: "4", width: 2000, height: 1200, src: "d" },
      { id: "5", width: 900, height: 1400, src: "e" },
    ];
    const { placements, totalHeight } = computeJustifiedLayout(items, {
      containerWidth: 1000,
      targetRowHeight: 260,
      gap: 5,
    });
    expect(placements).toHaveLength(5);
    expect(totalHeight).toBeGreaterThan(200);
    // First row items share the same y
    const y0 = placements[0]!.y;
    const firstRow = placements.filter((p) => p.y === y0);
    expect(firstRow.length).toBeGreaterThanOrEqual(1);
    const span =
      firstRow.reduce((sum, p) => sum + p.displayWidth, 0) +
      5 * (firstRow.length - 1);
    expect(span).toBeGreaterThan(900);
    expect(span).toBeLessThanOrEqual(1005);
  });

  it("returns empty layout for no items", () => {
    expect(computeJustifiedLayout([], { containerWidth: 800 })).toEqual({
      placements: [],
      totalHeight: 0,
    });
  });
});
