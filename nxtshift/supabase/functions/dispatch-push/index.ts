import { loadBaseDeps } from "../_shared/supabase-deps.ts";
import { createDispatchHandler } from "./handler.ts";

const base = loadBaseDeps();
Deno.serve(createDispatchHandler({ ...base, cronSecret: Deno.env.get("ESCALATION_CRON_SECRET") ?? "" }));
