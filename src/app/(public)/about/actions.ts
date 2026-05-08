"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { about } from "@/lib/store";
import { checkRateLimit, recordAttempt } from "@/lib/auth";

const ContactSchema = z.object({
  name: z.string().min(1, "Name required").max(100),
  email: z.string().email("Invalid email"),
  message: z.string().min(1, "Message required").max(2000),
});

export type ContactResult = { success: true } | { success: false; error: string };

export async function sendContactMessage(input: unknown): Promise<ContactResult> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`contact:${ip}`)) {
    return { success: false, error: "Too many messages. Please wait a minute and try again." };
  }
  recordAttempt(`contact:${ip}`);

  const parsed = ContactSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Validation error" };
  }

  const { name, email, message } = parsed.data;
  const content = await about.get();
  const { sendContactEmail } = await import("@/lib/email");
  await sendContactEmail(content.email, name, email, message);

  return { success: true };
}
