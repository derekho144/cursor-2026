import { describe, expect, it } from "vitest";
import {
  QUOTE_TEMPLATES,
  extrasFromSelectedTemplates,
  mergeQuoteTemplateItems,
  normalizeSelectedTemplates,
  toggleQuoteTemplateSelection,
} from "./quoteTemplates";

describe("quoteTemplates multi-select", () => {
  it("lists 攝影 / 攝影加錄影 / 純錄影", () => {
    expect(QUOTE_TEMPLATES.map((t) => t.id)).toEqual([
      "photoshoot",
      "photo_video",
      "video_only",
    ]);
  });

  it("toggles 攝影 and 攝影加錄影 on together", () => {
    let selected = toggleQuoteTemplateSelection([], "photoshoot");
    expect(selected).toEqual(["photoshoot"]);
    selected = toggleQuoteTemplateSelection(selected, "photo_video");
    expect(selected).toEqual(["photoshoot", "photo_video"]);
    selected = toggleQuoteTemplateSelection(selected, "photoshoot");
    expect(selected).toEqual(["photo_video"]);
  });

  it("merges photo + photo_video lines without duplicating shared rows", () => {
    const items = mergeQuoteTemplateItems(["photoshoot", "photo_video"]);
    const descs = items.map((i) => i.description);
    // photo_video is the superset — same lines as selecting photo_video alone
    expect(descs).toEqual(
      mergeQuoteTemplateItems(["photo_video"]).map((i) => i.description)
    );
    expect(descs).toContain("Event Photoshoot");
    expect(descs).toContain("Short Film Video Production");
    expect(descs.filter((d) => d === "Event Photoshoot")).toHaveLength(1);
    expect(descs.filter((d) => d === "Transportation Fee")).toHaveLength(1);
  });

  it("merges 攝影 + 純錄影 into photo and video billables", () => {
    const items = mergeQuoteTemplateItems(["photoshoot", "video_only"]);
    const descs = items.map((i) => i.description);
    expect(descs).toEqual([
      "Event Photoshoot",
      "Retouch (Post image editing included fine retouch of lighting, colour, sharpen, dust)",
      "Transportation Fee",
      "Short Film Video Production",
      "Post-Production (Video Editing 1min, Color Grading, Background Mixing)",
    ]);
  });

  it("picks photo_video extras when both photo templates are on", () => {
    const extras = extrasFromSelectedTemplates(["photoshoot", "photo_video"]);
    expect(extras.primaryTemplateId).toBe("photo_video");
    expect(extras.deliveryMethod).toMatch(/Video first cut/);
    expect(normalizeSelectedTemplates(["video_only", "photoshoot"])).toEqual([
      "photoshoot",
      "video_only",
    ]);
  });
});
