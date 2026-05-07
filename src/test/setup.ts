import { vi } from "vitest";

// Mock Next.js server-only modules
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  // Default: returns null for all headers → callers fall back to env vars.
  headers: vi.fn().mockResolvedValue({ get: () => null }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
