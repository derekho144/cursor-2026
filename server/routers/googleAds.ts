import { z } from "zod";
import { router, pageProcedure } from "../_core/trpc";

import {
  fetchGoogleAdsQualityDashboard,
  testGoogleAdsConnection,
} from "../googleAds";

const protectedProcedure = pageProcedure("google-ads-quality");
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
