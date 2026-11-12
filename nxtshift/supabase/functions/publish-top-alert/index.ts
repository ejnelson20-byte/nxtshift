import { loadBaseDeps } from "../_shared/supabase-deps.ts";
import { createPublishTopAlertHandler } from "./handler.ts";

Deno.serve(createPublishTopAlertHandler(loadBaseDeps()));
