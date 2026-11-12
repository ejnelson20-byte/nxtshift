// Trusted operator CLI for workspace provisioning. Run on an operator machine
// or CI job that holds the service-role key — never ship this in the app.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/provision-workspace.mts create --name "North Hall" --timezone America/New_York
//
//   # After the first admin joins from their own device and reads their
//   # callsign to you in person:
//   node scripts/provision-workspace.mts promote --workspace <uuid> --callsign ShiftLead_02 --role admin
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(2);
  }
  return value;
}

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    name: { type: "string" },
    timezone: { type: "string", default: "UTC" },
    workspace: { type: "string" },
    callsign: { type: "string" },
    role: { type: "string" },
  },
});

const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main(): Promise<void> {
  if (command === "create") {
    if (!values.name) throw new Error("--name is required");
    const { data, error } = await supabase.rpc("svc_provision_workspace", {
      p_name: values.name,
      p_timezone: values.timezone,
    });
    if (error) throw new Error(error.message);
    console.log(JSON.stringify(data, null, 2));
    console.log("Share the invite code only through your organization's trusted channel.");
    return;
  }
  if (command === "promote") {
    if (!values.workspace || !values.callsign || !values.role)
      throw new Error("--workspace, --callsign and --role are required");
    if (!["member", "lead", "admin"].includes(values.role)) throw new Error("--role must be member, lead or admin");
    const { data, error } = await supabase.rpc("svc_set_member_role", {
      p_workspace_id: values.workspace,
      p_callsign: values.callsign,
      p_role: values.role,
    });
    if (error) throw new Error(error.message);
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.error("Usage: provision-workspace.mts <create|promote> [options]");
  process.exit(2);
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
