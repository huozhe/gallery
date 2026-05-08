// Picks the storage implementation based on environment.
// KV_REST_API_URL set → Vercel KV + Blob (production)
// Otherwise          → file-based JSON store (local dev)

import * as fileStore from "./store.file";
import * as kvStore from "./store.kv";

const impl = process.env.REDIS_URL ? kvStore : fileStore;

export const artworks = impl.artworks;
export const tags = impl.tags;
export const users = impl.users;
export const sessions = impl.sessions;
export const passwordResets = impl.passwordResets;
export const audit = impl.audit;
export const about = impl.about;
export const blob = impl.blob;
export const seed = impl.seed;
