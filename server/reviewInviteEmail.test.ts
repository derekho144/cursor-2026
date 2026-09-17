import { describe, expect, it } from "vitest";
import {
  buildReviewInviteEmail,
  escapeHtml,
  serviceLabelEn,
  serviceLabelZh,
} from "./reviewInviteEmail";

describe("buildReviewInviteEmail", () => {
  it("defaults to bilingual subject and body", () => {
    const { subject, html } = buildReviewInviteEmail({
      clientName: "Alex Wong",
      serviceType: "product",
    });
    expect(subject).toContain("感謝您選擇 JD Studio");
    expect(subject).toContain("Thank you for choosing JD Studio");
    expect(html).toContain("親愛的 Alex Wong");
    expect(html).toContain("Dear Alex Wong");
    expect(html).toContain("產品攝影");
    expect(html).toContain("product photography");
    expect(html).toContain("Leave a Google review");
    expect(html).toContain("立即留下評價");
  });

  it("supports English-only", () => {
    const { subject, html } = buildReviewInviteEmail({
      clientName: "Sam",
      serviceType: "corporate_event",
      lang: "en",
    });
    expect(subject.startsWith("Thank you")).toBe(true);
    expect(html).toContain("corporate event photography");
    expect(html).not.toContain("親愛的");
  });

  it("escapes HTML in client name", () => {
    const { html } = buildReviewInviteEmail({
      clientName: `<img src=x onerror=alert(1)>`,
      lang: "en",
    });
    expect(html).not.toContain("<img");
    expect(html).toContain(escapeHtml(`<img src=x onerror=alert(1)>`));
  });

  it("maps service labels", () => {
    expect(serviceLabelZh("menu_design")).toBe("餐牌設計");
    expect(serviceLabelEn("menu_design")).toBe("menu design");
    expect(serviceLabelEn("unknown")).toBe("photography services");
  });
});
