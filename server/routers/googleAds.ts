import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  fetchGoogleAdsQualityDashboard,
  testGoogleAdsConnection,
} from "../googleAds";

export const googleAdsRouter = router({
  testConnection: protectedProcedure.query(async () => {
    return testGoogleAdsConnection();
  }),

  qualityDashboard: protectedProcedure
    .input(
      z
        .object({
          days: z.number().min(7).max(90).default(30),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const days = input?.days ?? 30;
      return fetchGoogleAdsQualityDashboard(days);
    }),
});
