// Auth primitives: argon2id password hashing, opaque-token sessions,
// in-memory rate limiter for sign-in attempts.
//
// In production (KV-backed store) the rate limiter should move to KV
// so it works across serverless instances. For now in-process is fine.

import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessions, users } from "@/lib/store";
import type { Session, User } from "@/data/types";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session-config";

export { SESSION_COOKIE, SESSION_TTL_SECONDS };

// OWASP 2024 argon2id baseline: m=19 MiB, t=2, p=1.
// algorithm: 2 = Argon2id (the Algorithm enum is ambient const so we use
// the numeric value to keep this compatible with isolatedModules).
const ARGON_PARAMS = {
  algorithm: 2 as const,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_PARAMS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Read the current session + user, or null if unauthenticated. */
export async function getSession(): Promise<{ user: User; session: Session } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await sessions.get(hashSessionToken(token));
  if (!session) return null;
  const user = await users.getById(session.userId);
  if (!user) return null;
  return { user, session };
}

/** Like getSession but redirects to sign-in when unauthenticated. */
export async function requireSession(nextPath = "/admin"): Promise<{ user: User; session: Session }> {
  const result = await getSession();
  if (!result) {
    const params = new URLSearchParams({ next: nextPath });
    redirect(`/admin/sign-in?${params.toString()}`);
  }
  return result;
}

// ---------- rate limit (in-process, sliding window) ----------

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;
const attempts = new Map<string, number[]>();

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  attempts.set(key, recent);
  return recent.length < RATE_MAX;
}

export function recordAttempt(key: string): void {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  attempts.set(key, recent);
}
