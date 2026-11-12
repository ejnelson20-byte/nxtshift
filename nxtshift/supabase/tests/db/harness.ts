// Test harness: applies the real Supabase migrations to an in-process
// PostgreSQL (PGlite) and offers helpers to act as specific users/roles.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "..", "migrations");

export type Row = Record<string, unknown>;

export class TestDb {
  readonly pg: PGlite;

  constructor(pg: PGlite) {
    this.pg = pg;
  }

  /** Superuser query (setup / inspection only). */
  async admin<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pg.query<T>(sql, params);
    return res.rows;
  }

  async createUser(): Promise<string> {
    const [row] = await this.admin<{ id: string }>("insert into auth.users default values returning id");
    return row.id;
  }

  /** Run a statement as an authenticated end user (RLS enforced). */
  async asUser<T extends Row = Row>(uid: string, sql: string, params: unknown[] = []): Promise<T[]> {
    return this.asRole<T>("authenticated", { sub: uid, role: "authenticated" }, sql, params);
  }

  async asAnon<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.asRole<T>("anon", { role: "anon" }, sql, params);
  }

  async asService<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.asRole<T>("service_role", { role: "service_role" }, sql, params);
  }

  private async asRole<T extends Row>(role: string, claims: Row, sql: string, params: unknown[]): Promise<T[]> {
    await this.pg.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
    await this.pg.exec(`set role ${role}`);
    try {
      const res = await this.pg.query<T>(sql, params);
      return res.rows;
    } finally {
      await this.pg.exec("reset role");
      await this.pg.query("select set_config('request.jwt.claims', '', false)");
    }
  }

  /** Call an RPC as a user and return its scalar result. */
  async rpc<T = unknown>(uid: string, fn: string, args: unknown[] = []): Promise<T> {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await this.asUser<{ r: T }>(uid, `select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  }

  async svc<T = unknown>(fn: string, args: unknown[] = []): Promise<T> {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await this.asService<{ r: T }>(`select public.${fn}(${placeholders}) as r`, args);
    return rows[0].r;
  }

  // ---- Fixtures --------------------------------------------------------

  async provisionWorkspace(name = "Test Hall", timezone = "America/New_York"): Promise<{ id: string; invite: string }> {
    const r = await this.svc<{ workspace_id: string; invite_code: string }>("svc_provision_workspace", [
      name,
      timezone,
    ]);
    return { id: r.workspace_id, invite: r.invite_code };
  }

  /** Create a user, join them to a workspace, optionally set role/token. */
  async member(
    ws: { id: string; invite: string },
    callsign: string,
    opts: { role?: "member" | "lead" | "admin"; token?: string | null } = {},
  ): Promise<{ uid: string; id: string }> {
    const uid = await this.createUser();
    const r = await this.svc<{ ok: boolean; member_id: string; error?: string }>("svc_join_workspace", [
      uid,
      ws.invite,
      callsign,
    ]);
    assert.equal(r.ok, true, `join failed for ${callsign}: ${r.error}`);
    if (opts.role && opts.role !== "member") {
      await this.svc("svc_set_member_role", [ws.id, callsign, opts.role]);
    }
    if (opts.token !== null) {
      const token = opts.token ?? `ExponentPushToken[${callsign.replace(/[^A-Za-z0-9]/g, "")}xxxxxxxxxx]`;
      await this.rpc(uid, "register_push_token", [token]);
    }
    return { uid, id: r.member_id };
  }

  /** Insert a shift relative to now() (minutes), bypassing lead RPC checks. */
  async shift(
    wsId: string,
    opts: {
      desk?: string;
      startMin: number;
      endMin: number;
      assigned?: string | null;
      backup?: string | null;
      checkedIn?: boolean;
    },
  ): Promise<string> {
    const [row] = await this.admin<{ id: string }>(
      `insert into public.shifts (workspace_id, desk_label, assigned_member_id, backup_member_id, start_time, end_time, is_checked_in)
       values ($1, $2, $3, $4, now() + make_interval(mins => $5), now() + make_interval(mins => $6), $7)
       returning id`,
      [
        wsId,
        opts.desk ?? "Front Desk",
        opts.assigned ?? null,
        opts.backup ?? null,
        opts.startMin,
        opts.endMin,
        opts.checkedIn ?? false,
      ],
    );
    return row.id;
  }

  async ageRows(table: string, column: string, id: string, minutes: number): Promise<void> {
    await this.admin(`update ${table} set ${column} = ${column} - make_interval(mins => $2) where id = $1`, [
      id,
      minutes,
    ]);
  }

  async outbox(pingId?: string): Promise<Row[]> {
    return pingId
      ? this.admin("select * from private.push_outbox where ping_id = $1 order by created_at, kind", [pingId])
      : this.admin("select * from private.push_outbox order by created_at, kind");
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}

export async function createDb(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.exec(readFileSync(join(here, "supabase-shim.sql"), "utf8"));
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    try {
      await pg.exec(readFileSync(join(migrationsDir, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return new TestDb(pg);
}

/** Assert that a promise rejects with a Postgres error whose message matches. */
export async function rejectsWith(promise: Promise<unknown>, pattern: string | RegExp): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    const message = (error as Error).message;
    const ok = typeof pattern === "string" ? message === pattern || message.includes(pattern) : pattern.test(message);
    assert.ok(ok, `expected error matching ${String(pattern)}, got: ${message}`);
    return true;
  });
}

export function uuid(): string {
  return crypto.randomUUID();
}
