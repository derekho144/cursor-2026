import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getAdsAttributionForPhone } from "../db";
import {
  getWhatsappCloudConfig,
  isWhatsappCloudConfigured,
  whatsappWebhookPublicUrl,
  sendWhatsappText,
  normalizeWaPhone,
} from "../_core/whatsappCloud";

export const whatsappRouter = router({
  /** Connection status for staff UI / ops. */
  status: protectedProcedure.query(() => {
    const cfg = getWhatsappCloudConfig();
    return {
      configured: isWhatsappCloudConfigured(),
      webhookUrl: whatsappWebhookPublicUrl(),
      phoneNumberIdSet: Boolean(cfg?.phoneNumberId),
      appSecretSet: Boolean(cfg?.appSecret),
      verifyTokenSet: Boolean(cfg?.verifyToken),
      tokenSet: Boolean(cfg?.token),
    };
  }),

  /**
   * When creating a quote: look up recent Cloud API inbound for this phone
   * and return matched Ads attribution (if auto-matched).
   */
  attributionForPhone: protectedProcedure
    .input(z.object({ phone: z.string().min(4).max(40) }))
    .query(async ({ input }) => {
      return getAdsAttributionForPhone(input.phone);
    }),

  /** Optional: send a text via Cloud API (staff tools). */
  sendText: protectedProcedure
    .input(
      z.object({
        phone: z.string().min(4).max(40),
        body: z.string().min(1).max(4000),
      })
    )
    .mutation(async ({ input }) => {
      const phone = normalizeWaPhone(input.phone);
      if (!phone) return { ok: false as const, error: "invalid_phone" };
      const result = await sendWhatsappText(phone, input.body);
      return result.ok
        ? { ok: true as const }
        : { ok: false as const, error: result.error || "send_failed" };
    }),
});
