import * as SecureStore from "expo-secure-store";

// Supabase sessions exceed the size SecureStore reliably accepts in a single
// entry (~2 KB), so values are split across numbered Keychain/Keystore entries.
// Everything stays inside the OS secure enclave-backed store.
const CHUNK_SIZE = 1800;

export type KeyValueBackend = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

const secureOptions: SecureStore.SecureStoreOptions = {
  // Available after first unlock so token refresh works while the device is
  // locked in a pocket, but never migrated to other devices or backups.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const defaultBackend: KeyValueBackend = {
  getItemAsync: (k) => SecureStore.getItemAsync(k, secureOptions),
  setItemAsync: (k, v) => SecureStore.setItemAsync(k, v, secureOptions),
  deleteItemAsync: (k) => SecureStore.deleteItemAsync(k, secureOptions),
};

// SecureStore keys allow only [A-Za-z0-9._-].
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

export function createChunkedSecureStorage(backend: KeyValueBackend = defaultBackend) {
  const countKey = (key: string) => `${safeKey(key)}.count`;
  const chunkKey = (key: string, i: number) => `${safeKey(key)}.${i}`;

  async function removeItem(key: string): Promise<void> {
    const count = Number((await backend.getItemAsync(countKey(key))) ?? "0");
    await Promise.all(Array.from({ length: count }, (_, i) => backend.deleteItemAsync(chunkKey(key, i))));
    await backend.deleteItemAsync(countKey(key));
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const countRaw = await backend.getItemAsync(countKey(key));
      if (countRaw === null) return null;
      const count = Number(countRaw);
      const parts = await Promise.all(Array.from({ length: count }, (_, i) => backend.getItemAsync(chunkKey(key, i))));
      // A missing chunk means a torn write; treat as no session.
      if (parts.some((p) => p === null)) return null;
      return parts.join("");
    },
    async setItem(key: string, value: string): Promise<void> {
      await removeItem(key);
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) chunks.push(value.slice(i, i + CHUNK_SIZE));
      await Promise.all(chunks.map((c, i) => backend.setItemAsync(chunkKey(key, i), c)));
      // Count written last so readers never see a partial value as complete.
      await backend.setItemAsync(countKey(key), String(chunks.length));
    },
    removeItem,
  };
}
