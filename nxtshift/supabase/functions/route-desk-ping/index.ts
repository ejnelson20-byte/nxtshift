import { loadBaseDeps } from "../_shared/supabase-deps.ts";
import { createRouteDeskPingHandler } from "./handler.ts";

Deno.serve(createRouteDeskPingHandler(loadBaseDeps()));
