// Migrations are applied by hand, so "the plan's tables are not there yet" is a
// real state: the routes name the fix rather than answering a bare 500.
export const PLAN_MIGRATION_HINT =
  "What's next needs the database migration supabase/migrations/20261103120000_application_events.sql. Run it in the Supabase SQL editor, then try again.";

export const ACTION_MIGRATION_HINT =
  "This needs the database migration supabase/migrations/20261104120000_action_centre.sql. Run it in the Supabase SQL editor, then try again.";

// PGRST205 / 42P01: no such table. 42703 / PGRST204: no such column.
export function isMissingPlanSchema(error: { code?: string } | null | undefined): boolean {
  return !!error && ["PGRST205", "42P01", "42703", "PGRST204"].includes(error.code ?? "");
}
