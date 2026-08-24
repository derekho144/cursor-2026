import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
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
});
