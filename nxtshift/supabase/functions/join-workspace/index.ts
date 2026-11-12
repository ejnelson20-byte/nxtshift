import { loadBaseDeps } from "../_shared/supabase-deps.ts";
import { createJoinHandler } from "./handler.ts";

const base = loadBaseDeps();
const salt = Deno.env.get("RATE_LIMIT_SALT");
if (!salt) console.warn(JSON.stringify({ level: "warn", event: "rate_limit_salt_missing" }));

Deno.serve(createJoinHandler({ ...base, rateLimitSalt: salt ?? "" }));
