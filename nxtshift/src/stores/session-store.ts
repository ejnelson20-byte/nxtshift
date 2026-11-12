import type { Session } from "@supabase/supabase-js";
import { create } from "zustand";
import type { MemberContext } from "@/types/domain";

export type SessionStatus =
  | "booting" // restoring session from secure storage
  | "unconfigured" // build is missing EXPO_PUBLIC_* configuration
  | "signed_out" // no membership (may still hold an anonymous session to reuse)
  | "ready"; // member of a workspace

type SessionState = {
  status: SessionStatus;
  session: Session | null;
  profile: MemberContext | null;
  /** True when profile came from the offline cache and hasn't been re-verified. */
  profileIsCached: boolean;
  signedOutReason: "expired" | "removed" | null;
  setSession: (session: Session | null) => void;
  setReady: (profile: MemberContext, cached?: boolean) => void;
  setSignedOut: (reason?: SessionState["signedOutReason"]) => void;
  setUnconfigured: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  status: "booting",
  session: null,
  profile: null,
  profileIsCached: false,
  signedOutReason: null,
  setSession: (session) => set({ session }),
  setReady: (profile, cached = false) =>
    set({ status: "ready", profile, profileIsCached: cached, signedOutReason: null }),
  setSignedOut: (reason = null) =>
    set({ status: "signed_out", profile: null, profileIsCached: false, signedOutReason: reason }),
  setUnconfigured: () => set({ status: "unconfigured" }),
}));

export const isLeadRole = (profile: MemberContext | null) => profile?.role === "lead" || profile?.role === "admin";
