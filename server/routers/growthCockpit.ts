import { protectedProcedure, router } from "../_core/trpc";
import { getGrowthCockpit } from "../growthCockpit";

export const growthCockpitRouter = router({
  overview: protectedProcedure.query(async () => getGrowthCockpit()),
});
