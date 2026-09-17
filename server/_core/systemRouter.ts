import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getQuotesPendingReviewEmail, markReviewEmailSent } from "../db";
import { sendEmail } from "../resendEmail";
import { buildReviewInviteEmail } from "../reviewInviteEmail";

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
          const { subject, html } = buildReviewInviteEmail({
            clientName: quote.clientName,
            serviceType: quote.serviceType,
          });
          const result = await sendEmail({
            to: quote.clientEmail!,
            subject,
            html,
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
