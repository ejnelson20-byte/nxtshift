import { create } from "zustand";

export type BannerTone = "success" | "error" | "info";
type Banner = { id: number; tone: BannerTone; message: string };

type BannerState = {
  banner: Banner | null;
  show: (tone: BannerTone, message: string) => void;
  dismiss: () => void;
};

let nextId = 1;

export const useBannerStore = create<BannerState>((set) => ({
  banner: null,
  show: (tone, message) => set({ banner: { id: nextId++, tone, message } }),
  dismiss: () => set({ banner: null }),
}));

export const showBanner = (tone: BannerTone, message: string) => useBannerStore.getState().show(tone, message);
