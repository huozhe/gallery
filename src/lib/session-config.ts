// Edge-safe constants. Don't import anything that pulls in Node-only deps
// (argon2, fs, etc.) — this file is reachable from middleware.

export const SESSION_COOKIE = "gallery_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
