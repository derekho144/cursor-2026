/**
 * Google review invitation email (ZH + EN).
 * Used by scheduler auto-send and admin triggerReviewInvites.
 */

export const GOOGLE_REVIEW_URL =
  "https://www.google.com/maps/place/JD+Studio/@22.3360662,114.1980294,17z/data=!4m8!3m7!1s0x34040714d8082109:0x60cb3968ea99b2e6!8m2!3d22.3360662!4d114.1980294!9m1!1b1!16s%2Fg%2F11x8hbsvg7?entry=ttu";

const SERVICE_LABELS_ZH: Record<string, string> = {
  corporate_event: "企業活動攝影",
  product: "產品攝影",
  food_beverage: "飲食攝影",
  jewelry: "珠寶攝影",
  artwork: "藝術品攝影",
  interior: "室內攝影",
  video_production: "影片製作",
  graphic_design: "平面設計",
  ad_video: "廣告影片",
  web_development: "網頁開發",
  ai_photography: "AI 攝影",
  menu_design: "餐牌設計",
  portrait: "人像拍攝",
  "360_photography": "360 拍攝",
  drone: "航拍拍攝",
  kol_mi: "KOL/MI 推廣",
  other: "攝影服務",
};

const SERVICE_LABELS_EN: Record<string, string> = {
  corporate_event: "corporate event photography",
  product: "product photography",
  food_beverage: "food & beverage photography",
  jewelry: "jewelry photography",
  artwork: "artwork photography",
  interior: "interior photography",
  video_production: "video production",
  graphic_design: "graphic design",
  ad_video: "advertisement video",
  web_development: "web development",
  ai_photography: "AI photography",
  menu_design: "menu design",
  portrait: "portrait photography",
  "360_photography": "360 photography",
  drone: "drone photography",
  kol_mi: "KOL / micro film",
  other: "photography services",
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function serviceLabelZh(serviceType: string | null | undefined): string {
  return SERVICE_LABELS_ZH[serviceType ?? ""] || "攝影服務";
}

export function serviceLabelEn(serviceType: string | null | undefined): string {
  return SERVICE_LABELS_EN[serviceType ?? ""] || "photography services";
}

export type ReviewInviteLang = "zh" | "en" | "both";

export function buildReviewInviteEmail(input: {
  clientName?: string | null;
  serviceType?: string | null;
  /** Default bilingual (both) so EN clients always get an English version. */
  lang?: ReviewInviteLang;
}): { subject: string; html: string } {
  const lang = input.lang ?? "both";
  const rawName = (input.clientName || "").trim();
  const nameZh = escapeHtml(rawName || "您");
  const nameEn = escapeHtml(rawName || "there");
  const labelZh = escapeHtml(serviceLabelZh(input.serviceType));
  const labelEn = escapeHtml(serviceLabelEn(input.serviceType));
  const reviewUrl = GOOGLE_REVIEW_URL;

  const subject =
    lang === "en"
      ? "Thank you for choosing JD Studio — we'd love your review ⭐"
      : lang === "zh"
        ? "感謝您選擇 JD Studio — 歡迎留下您的評價 ⭐"
        : "感謝您選擇 JD Studio — 歡迎留下您的評價 ⭐ | Thank you for choosing JD Studio";

  const zhBlock = `
    <h2 style="color: #1a1a1a; margin: 0 0 12px;">感謝您選擇 JD Studio！</h2>
    <p>親愛的 ${nameZh}，</p>
    <p>非常感謝您選擇 JD Studio 為您提供<strong>${labelZh}</strong>服務。希望您對我們的服務感到滿意！</p>
    <p>如果您有時間，歡迎在 Google 上留下您的評價，這對我們非常重要，也能幫助更多客戶了解我們的服務：</p>
    <div style="text-align: center; margin: 28px 0;">
      <a href="${reviewUrl}"
         style="background-color: #4285F4; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold; display: inline-block;">
        ⭐ 立即留下評價
      </a>
    </div>
    <p style="color: #666; font-size: 14px;">只需 1 分鐘，您的評價對我們意義重大。感謝您的支持！</p>
  `;

  const enBlock = `
    <h2 style="color: #1a1a1a; margin: 0 0 12px;">Thank you for choosing JD Studio!</h2>
    <p>Dear ${nameEn},</p>
    <p>Thank you for choosing JD Studio for your <strong>${labelEn}</strong>. We hope you were happy with our work!</p>
    <p>If you have a moment, we'd be grateful if you could leave us a Google review — it means a lot to our team and helps others discover our services:</p>
    <div style="text-align: center; margin: 28px 0;">
      <a href="${reviewUrl}"
         style="background-color: #4285F4; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold; display: inline-block;">
        ⭐ Leave a Google review
      </a>
    </div>
    <p style="color: #666; font-size: 14px;">It only takes about a minute. Thank you for your support!</p>
  `;

  let body = "";
  if (lang === "zh") body = zhBlock;
  else if (lang === "en") body = enBlock;
  else {
    body = `${zhBlock}
    <hr style="border: none; border-top: 1px solid #eee; margin: 28px 0;">
    ${enBlock}`;
  }

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.55;">
      ${body}
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
      <p style="color: #999; font-size: 12px; margin: 0;">
        JD Studio | Professional photography &amp; video production<br>
        JD Studio | 專業攝影及影片製作
      </p>
    </div>
  `.trim();

  return { subject, html };
}
