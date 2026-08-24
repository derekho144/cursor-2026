import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  backfillStructuredShootFields,
  getPricingLearningByServiceType,
  getPricingLearningOverview,
  suggestPriceFromLearning,
} from "../pricingLearning";

const serviceTypeSchema = z.enum([
  "corporate_event",
  "product",
  "food_beverage",
  "jewelry",
  "artwork",
  "interior",
  "video_production",
  "graphic_design",
  "ad_video",
  "web_development",
  "ai_photography",
  "menu_design",
  "portrait",
  "360_photography",
  "drone",
  "kol_mi",
  "other",
]);

export const pricingLearningRouter = router({
  overview: protectedProcedure.query(async () => {
    return getPricingLearningOverview();
  }),

  byServiceType: protectedProcedure
    .input(z.object({ serviceType: serviceTypeSchema }))
    .query(async ({ input }) => {
      return getPricingLearningByServiceType(input.serviceType);
    }),

  suggest: protectedProcedure
    .input(
      z.object({
        serviceType: serviceTypeSchema,
        hours: z.number().min(0.5).max(72).optional().nullable(),
        crewSize: z.number().int().min(1).max(20).optional().nullable(),
      })
    )
    .query(async ({ input }) => {
      return suggestPriceFromLearning({
        serviceType: input.serviceType,
        hours: input.hours,
        crewSize: input.crewSize,
      });
    }),

  /** One-shot: fill structured hours/crew from historical free text when empty. */
  backfillStructured: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(2000).default(500),
          dryRun: z.boolean().default(false),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      return backfillStructuredShootFields({
        limit: input?.limit ?? 500,
        dryRun: input?.dryRun ?? false,
      });
    }),
});
