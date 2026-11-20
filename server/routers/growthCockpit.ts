import { router, pageProcedure } from "../_core/trpc";

import { getGrowthCockpit } from "../growthCockpit";

const protectedProcedure = pageProcedure("growth-cockpit");
export const growthCockpitRouter = router({
  overview: protectedProcedure.query(async () => getGrowthCockpit()),
});
