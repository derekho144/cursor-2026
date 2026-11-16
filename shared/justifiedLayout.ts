/**
 * PicSpot-style justified row layout.
 * Target row height; scale each image so the row fills `containerWidth`.
 */

export type JustifiedItem = {
  id: string;
  width: number;
  height: number;
  src: string;
  fullSrc?: string;
  name?: string;
};

export type JustifiedPlacement = JustifiedItem & {
  x: number;
  y: number;
  displayWidth: number;
  displayHeight: number;
};

export type JustifiedLayoutResult = {
  placements: JustifiedPlacement[];
  totalHeight: number;
};

export function computeJustifiedLayout(
  items: JustifiedItem[],
  opts: {
    containerWidth: number;
    targetRowHeight?: number;
    gap?: number;
  }
): JustifiedLayoutResult {
  const containerWidth = Math.max(1, opts.containerWidth);
  const targetRowHeight = opts.targetRowHeight ?? 280;
  const gap = opts.gap ?? 5;

  if (items.length === 0) {
    return { placements: [], totalHeight: 0 };
  }

  const placements: JustifiedPlacement[] = [];
  let row: JustifiedItem[] = [];
  let rowAspect = 0;
  let y = 0;

  const flushRow = (isLast: boolean) => {
    if (row.length === 0) return;
    const gapsTotal = gap * (row.length - 1);
    const available = Math.max(1, containerWidth - gapsTotal);
    // Last row: don't stretch excessively if sparse
    let rowHeight = available / rowAspect;
    if (isLast && rowHeight > targetRowHeight * 1.25) {
      rowHeight = targetRowHeight;
    }
    let x = 0;
    for (const item of row) {
      const aspect = item.width / Math.max(1, item.height);
      const displayWidth = rowHeight * aspect;
      const displayHeight = rowHeight;
      placements.push({
        ...item,
        x,
        y,
        displayWidth,
        displayHeight,
      });
      x += displayWidth + gap;
    }
    y += rowHeight + gap;
    row = [];
    rowAspect = 0;
  };

  for (const item of items) {
    const w = Math.max(1, item.width);
    const h = Math.max(1, item.height);
    const aspect = w / h;
    const nextAspect = rowAspect + aspect;
    const gapsTotal = gap * row.length; // gaps if we add this item
    const widthAtTarget = nextAspect * targetRowHeight + gapsTotal;

    if (row.length > 0 && widthAtTarget >= containerWidth) {
      flushRow(false);
    }
    row.push({ ...item, width: w, height: h });
    rowAspect += aspect;
  }
  flushRow(true);

  const totalHeight = Math.max(0, y - gap);
  return { placements, totalHeight };
}
