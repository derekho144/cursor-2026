/**
 * Cancel all unpublished LinkedIn content schedules (incl. Buffer) and regenerate
 * for the active timetable week (rolls forward if Fri slot already passed).
 *
 * Usage (on server with DATABASE_URL): npx tsx scripts/reset-linkedin-week.ts
 */
import "dotenv/config";
import { resetSchedulesAndRegenerate } from "../server/linkedinContentFactory";

async function main() {
  const result = await resetSchedulesAndRegenerate();
  console.log(
    JSON.stringify(
      {
        deleted: result.deleted,
        bufferCancelled: result.bufferCancelled,
        bufferErrors: result.bufferErrors,
        weekKey: result.generated.weekKey,
        created: result.generated.created,
        existing: result.generated.existing,
        rolledFromPastWeek: result.generated.rolledFromPastWeek,
        schedule: result.generated.schedule,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
