import * as Crypto from "expo-crypto";

/** CSPRNG UUID v4 used as an idempotency key for mutating requests. */
export function newRequestId(): string {
  return Crypto.randomUUID();
}
