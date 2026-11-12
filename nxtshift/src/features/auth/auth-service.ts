import * as SecureStore from "expo-secure-store";
import { ApiError } from "@/lib/errors";
import { queryClient } from "@/lib/query-client";
import { requireSupabase } from "@/lib/supabase";
import { invokeFunction, rpc } from "@/services/api";
import { useSessionStore } from "@/stores/session-store";
import { cancelShiftReminders } from "@/features/shifts/reminder-sync";
import type { MemberContext } from "@/types/domain";

const PROFILE_CACHE_KEY = "nxtshift.profile";
const secureOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

async function cacheProfile(profile: MemberContext | null): Promise<void> {
  if (profile) await SecureStore.setItemAsync(PROFILE_CACHE_KEY, JSON.stringify(profile), secureOptions);
  else await SecureStore.deleteItemAsync(PROFILE_CACHE_KEY, secureOptions);
}

async function readCachedProfile(): Promise<MemberContext | null> {
  const raw = await SecureStore.getItemAsync(PROFILE_CACHE_KEY, secureOptions).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MemberContext;
  } catch {
    return null;
  }
}

/** Re-fetch membership from the server (source of truth for role). */
export async function refreshProfile(): Promise<MemberContext | null> {
  const profile = await rpc<MemberContext | null>("get_my_context");
  const store = useSessionStore.getState();
  if (profile) {
    store.setReady(profile);
    await cacheProfile(profile);
  } else if (store.status === "ready") {
    // Membership was removed server-side (or the workspace was deleted).
    await cacheProfile(null);
    store.setSignedOut("removed");
  }
  return profile;
}

/**
 * Restore an existing session at launch. Offline launches fall back to the
 * cached profile (clearly marked as cached) so the app stays usable.
 */
export async function restoreSession(): Promise<void> {
  const store = useSessionStore.getState();
  const supabase = requireSupabase();
  const { data } = await supabase.auth.getSession();
  store.setSession(data.session);
  if (!data.session) {
    store.setSignedOut();
    return;
  }
  try {
    const profile = await refreshProfile();
    if (!profile) store.setSignedOut();
  } catch {
    // Offline or server unavailable: keep the app usable with the last known
    // membership. It is re-verified on the next successful request.
    const cached = await readCachedProfile();
    if (cached) store.setReady(cached, true);
    else store.setSignedOut();
  }
}

/**
 * Join flow: anonymous auth (reusing an existing anonymous session when
 * present) → join-workspace Edge Function → load membership.
 */
export async function joinWorkspace(inviteCode: string, callsign: string): Promise<MemberContext> {
  const supabase = requireSupabase();
  let {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.session)
      throw new ApiError(error?.status === 429 ? "rate_limited" : "network_error", error?.status);
    session = data.session;
  }
  useSessionStore.getState().setSession(session);

  await invokeFunction("join-workspace", { invite_code: inviteCode, callsign });
  const profile = await refreshProfile();
  if (!profile) throw new ApiError("unknown");
  return profile;
}

/**
 * Leave the workspace and sign out. Anonymous identities cannot be recovered
 * after sign-out, so the membership is deleted server-side first.
 */
export async function leaveAndSignOut(): Promise<void> {
  const supabase = requireSupabase();
  await rpc("clear_push_token").catch(() => undefined);
  await rpc("leave_workspace");
  await signOutLocal();
  await supabase.auth.signOut().catch(() => undefined);
}

/** Clear all local state (used on sign-out and when the session expires). */
export async function signOutLocal(reason: "expired" | "removed" | null = null): Promise<void> {
  await cancelShiftReminders().catch(() => undefined);
  await cacheProfile(null).catch(() => undefined);
  queryClient.clear();
  useSessionStore.getState().setSignedOut(reason);
}
