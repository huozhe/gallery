// Bootstrap the first admin user.
// Usage: npm run admin:create -- email password

import { ulid } from "ulid";
import { z } from "zod";
import { audit, users } from "../src/lib/store";
import { hashPassword } from "../src/lib/auth";

const Input = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(12, "Password must be at least 12 characters"),
});

async function main() {
  const [emailArg, passwordArg, ...extra] = process.argv.slice(2);
  if (!emailArg || !passwordArg || extra.length) {
    console.error("Usage: npm run admin:create -- <email> <password>");
    process.exit(2);
  }

  const parsed = Input.safeParse({ email: emailArg, password: passwordArg });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      console.error(`error: ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  const { email, password } = parsed.data;

  if (await users.getByEmail(email)) {
    console.error(`User ${email} already exists`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const user = await users.upsert({
    id: ulid(),
    email,
    passwordHash,
    createdAt: now,
  });

  await audit.log({
    id: ulid(),
    at: now,
    actorId: "system",
    actorEmail: "system",
    action: "user.create",
    target: user.id,
  });

  console.log(`Created admin user ${user.email} (${user.id})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
