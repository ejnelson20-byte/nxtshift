# nxtshift

**Reach the active desk without knowing who is working.**

nxtshift is a privacy-focused, multi-tenant mobile app for organizations that run rotating 24/7 duty desks (residential life, campus safety, security operations, facilities, on-call teams). Members join with an invite code and an anonymous callsign, press one button to notify whoever holds the active duty window, and the backend escalates automatically if nobody acknowledges within three minutes.

> nxtshift is not HIPAA-certified and is not suitable for classified information. Do not market or deploy it for those purposes without separate legal, technical and organizational authorization. See [SECURITY.md](SECURITY.md).

- [ARCHITECTURE.md](ARCHITECTURE.md): system design, data model, ping routing, escalation, notification delivery, tradeoffs
- [SECURITY.md](SECURITY.md): threat model, RLS model, data retention, anonymous-account limitations

## Tech stack

| Layer            | Technology                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile           | Expo SDK 58, React Native 0.88, React 19.3, TypeScript (strict), Expo Router, NativeWind 4 (Tailwind 3.4), Reanimated 4               |
| State/data       | TanStack Query 5, Zustand 5, React Hook Form + Zod 4                                                                                  |
| Device           | expo-secure-store, expo-notifications, expo-device, expo-constants, expo-haptics, expo-crypto, lucide-react-native                    |
| Backend          | Supabase (Postgres 17, Anonymous Auth, RLS, Realtime, Edge Functions on Deno 2), pg_cron, pg_net, Vault                               |
| Push             | Expo Push API (tickets + receipts)                                                                                                    |
| Schedule parsing | Claude via the Anthropic SDK (`claude-opus-5-5` default, configurable), structured JSON output                                        |
| Tooling          | ESLint 9 (eslint-config-expo), Prettier, Jest + React Native Testing Library, `node:test` + PGlite for database tests, GitHub Actions |

## Project structure

```text
nxtshift/
├── app/                         Expo Router routes
│   ├── _layout.tsx              providers, auth bootstrap, notification responses
│   ├── index.tsx                session gate
│   ├── (auth)/welcome.tsx, join.tsx
│   └── (tabs)/index.tsx (Desk), shifts.tsx (My Shifts), lead.tsx (Lead Console)
├── src/
│   ├── components/{ui,desk,shifts,lead}/
│   ├── features/{auth,desk,shifts,lead,notifications,schedule-import}/   api + hooks per feature
│   ├── hooks/  lib/  services/  stores/  theme/  types/  utils/
├── supabase/
│   ├── config.toml
│   ├── migrations/              7 ordered SQL migrations (schema → RLS → RPCs → jobs)
│   ├── functions/
│   │   ├── _shared/             runtime-neutral logic (HTTP, Expo push, dispatcher, schedule parsing)
│   │   ├── join-workspace/  route-desk-ping/  publish-top-alert/
│   │   ├── parse-shift-schedule/  dispatch-push/
│   │   └── deno.json
│   └── tests/{db,functions}/    PGlite-backed RLS/RPC tests + Edge Function integration tests
├── scripts/provision-workspace.mts   trusted operator CLI (service role)
├── __tests__/                   Jest app tests
├── app.config.ts  eas.json  .env.example  tailwind.config.js  metro.config.js  babel.config.js
```

Each Edge Function has a dependency-injected `handler.ts` (testable under Node) and a thin Deno `index.ts`. `manage-shifts` and `register-device` from the original outline are SECURITY DEFINER RPCs rather than Edge Functions. They need no secrets or external calls, and keeping them in SQL makes them transactional and testable against RLS directly (see ARCHITECTURE.md).

## Prerequisites

- Node.js ≥ 24 and npm
- [Supabase CLI](https://supabase.com/docs/guides/cli) and Docker (local stack)
- Deno 2 (optional locally, for `npm run check:functions`; CI installs it)
- An [Expo](https://expo.dev) account and `eas-cli` for device builds and push credentials
- A physical iOS or Android device (push notifications do not work in simulators)

## Local development

1. **Install dependencies**

   ```sh
   cd nxtshift
   npm install
   ```

2. **Configure Expo / EAS.** Run `npx eas init` to create the project and note the project ID (UUID).

3. **Start local Supabase.** This also applies every migration in `supabase/migrations`:

   ```sh
   supabase start
   ```

   To re-apply from scratch later, run `supabase db reset`.

4. **Configure environment variables**

   ```sh
   cp .env.example .env
   # EXPO_PUBLIC_SUPABASE_URL           = API URL from `supabase status` (use your machine's LAN IP for a physical device)
   # EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishable key from `supabase status`
   #                                      (legacy projects: EXPO_PUBLIC_SUPABASE_ANON_KEY)
   # EXPO_PUBLIC_EAS_PROJECT_ID         = from step 2
   ```

   Function secrets go in `supabase/functions/.env` (git-ignored): `ESCALATION_CRON_SECRET` (≥ 32 random characters), `LLM_API_KEY`, optionally `LLM_MODEL`, `EXPO_ACCESS_TOKEN`, `RATE_LIMIT_SALT`. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

5. **Start Edge Functions**

   ```sh
   supabase functions serve --env-file supabase/functions/.env
   ```

6. **Wire the scheduler to the dispatcher.** Run this once per database, in Studio's SQL editor or with `psql`. Until it's done, escalations are still _recorded_ every 15 seconds by pg_cron, but pushes are only sent by the inline dispatch in `route-desk-ping` / `publish-top-alert`.

   ```sql
   select vault.create_secret('http://host.docker.internal:54321/functions/v1', 'nxtshift_functions_url');
   select vault.create_secret('<same value as ESCALATION_CRON_SECRET>', 'nxtshift_cron_secret');
   ```

7. **Provision a workspace** (trusted operator step; never from the app):

   ```sh
   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<from supabase status> \
     npm run provision -- create --name "North Hall" --timezone America/New_York
   ```

   This prints the invite code. After the first admin joins from their own device and tells you their callsign in person:

   ```sh
   npm run provision -- promote --workspace <workspace_id> --callsign ShiftLead_02 --role admin
   ```

8. **Run the app on a physical device.** Push notifications and the ACKNOWLEDGE action need a development build (not Expo Go):

   ```sh
   npx eas build --profile development --platform ios   # or android
   npm run start:dev-client
   ```

## Testing

```sh
npm run lint            # ESLint
npm run format:check    # Prettier
npm run typecheck       # app (tsconfig.json) + server code (tsconfig.server.json)
npm run test:app        # Jest + React Native Testing Library
npm run test:backend    # real migrations on in-process PostgreSQL (PGlite) + Edge Function integration tests
npm run check:functions # deno check of every Edge Function (requires Deno)
npm run export:native   # production Metro bundles for iOS and Android
```

Backend tests run the actual migration files against PostgreSQL 18 (PGlite) with a small shim for Supabase's `auth` schema and roles. The shim reproduces Supabase's permissive default grants, so the tests prove nxtshift's revokes work. External APIs (Expo push, the LLM) are mocked deterministically. pg_cron, pg_net and Vault are not present in PGlite; the CI `supabase` job applies the migrations on the real Supabase stack and checks that the cron jobs exist.

## Database migrations

Migrations live in `supabase/migrations` and are applied in filename order.

```sh
supabase migration new <name>   # create
supabase db reset               # re-apply locally
supabase link --project-ref <ref> && supabase db push   # apply to a hosted project
```

Never add `private` to the Data API's exposed schemas.

## Edge Function deployment

```sh
supabase secrets set --env-file supabase/functions/.env   # ESCALATION_CRON_SECRET, LLM_API_KEY, RATE_LIMIT_SALT, ...
supabase functions deploy join-workspace route-desk-ping publish-top-alert parse-shift-schedule dispatch-push
```

Then create the two Vault secrets from step 6 using `https://<project-ref>.supabase.co/functions/v1` as the URL. In the dashboard, enable **Anonymous sign-ins** and leave email/phone sign-up disabled. Consider enabling CAPTCHA (Turnstile/hCaptcha) for anonymous sign-ins in production.

## EAS builds

`eas.json` defines three profiles. `APP_VARIANT` selects the bundle identifier and app name in `app.config.ts`:

| Profile     | Bundle ID suffix | Distribution                          |
| ----------- | ---------------- | ------------------------------------- |
| development | `.dev`           | internal, dev client                  |
| preview     | `.preview`       | internal                              |
| production  | (none)           | store, auto-incremented build numbers |

Set `EXPO_PUBLIC_*` values per environment with `eas env:create` (they are public, not secrets). Push credentials:

- **iOS:** `eas credentials` → create or upload an APNs key.
- **Android:** upload an FCM V1 service-account key in `eas credentials`, and provide `google-services.json` as an EAS file secret named `GOOGLE_SERVICES_JSON`.

```sh
npx eas build --profile production --platform all
```

## Dependency notes

`npm audit` reports 3 moderate advisories in `minimatch` via `@expo/fingerprint`, a build-time dependency of `expo`. The only automatic "fix" downgrades to Expo SDK 52, so they are tracked rather than forced. CI fails on high or critical advisories in production dependencies.
