import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getQuotesPendingReviewEmail, markReviewEmailSent } from "../db";
import { sendEmail } from "../resendEmail";

const SERVICE_TYPE_MAP: Record<string, string> = {
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
  other: "攝影服務",
};

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  triggerReviewInvites: adminProcedure
    .mutation(async () => {
      const pending = await getQuotesPendingReviewEmail();
      let sent = 0;
      let failed = 0;
      const results: { quoteId: number; clientName: string; clientEmail: string; status: string }[] = [];

      for (const quote of pending) {
        try {
          const clientName = quote.clientName || "您";
          const serviceLabel = SERVICE_TYPE_MAP[quote.serviceType ?? ""] || "攝影服務";
          const result = await sendEmail({
            to: quote.clientEmail!,
            subject: `感謝您選擇 JD Studio — 歡迎留下您的評價 ⭐`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <h2 style="color: #1a1a1a;">感謝您選擇 JD Studio！</h2>
                <p>親愛的 ${clientName}，</p>
                <p>非常感謝您選擇 JD Studio 為您提供<strong>${serviceLabel}</strong>服務。希望您對我們的服務感到滿意！</p>
                <p>如果您有時間，歡迎在 Google 上留下您的評價，這對我們非常重要，也能幫助更多客戶了解我們的服務：</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="https://www.google.com/maps/place/JD+Studio/@22.3360662,114.1980294,17z/data=!4m8!3m7!1s0x34040714d8082109:0x60cb3968ea99b2e6!8m2!3d22.3360662!4d114.1980294!9m1!1b1!16s%2Fg%2F11x8hbsvg7?entry=ttu&g_ep=EgoyMDI2MDMyNC4wIKXMDSoASAFQAw%3D%3D"
                     style="background-color: #4285F4; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold;">
                    ⭐ 立即留下評價
                  </a>
                </div>
                <p style="color: #666; font-size: 14px;">只需 1 分鐘，您的評價對我們意義重大。感謝您的支持！</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="color: #999; font-size: 12px;">JD Studio | 專業攝影及影片製作</p>
              </div>
            `,
          });
          if (result.success) {
            await markReviewEmailSent(quote.id);
            sent++;
            results.push({ quoteId: quote.id, clientName, clientEmail: quote.clientEmail!, status: "sent" });
          } else {
            failed++;
            results.push({ quoteId: quote.id, clientName, clientEmail: quote.clientEmail!, status: `failed: ${result.error}` });
          }
        } catch (err) {
          failed++;
          results.push({ quoteId: quote.id, clientName: quote.clientName || "", clientEmail: quote.clientEmail || "", status: `error: ${err}` });
        }
      }
      return { total: pending.length, sent, failed, results };
    }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
