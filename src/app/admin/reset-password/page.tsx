import Link from "next/link";
import { hashSessionToken } from "@/lib/auth";
import { passwordResets } from "@/lib/store";
import { completePasswordReset } from "../actions";

const ERROR_MESSAGES: Record<string, string> = {
  expired: "This reset link has expired or already been used.",
  invalid: "Invalid request. Please request a new reset link.",
  notfound: "Account not found. Please contact the site owner.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token: rawToken, error } = await searchParams;

  if (error || !rawToken) {
    return (
      <main className="px-8 py-16 max-w-sm mx-auto">
        <h1 className="text-xl font-medium mb-4">Reset link invalid</h1>
        <p className="text-sm text-red-600 mb-6">
          {ERROR_MESSAGES[error ?? "invalid"] ?? ERROR_MESSAGES.invalid}
        </p>
        <Link
          href="/admin/forgot-password"
          className="text-sm underline text-neutral-600 hover:text-neutral-900"
        >
          Request a new link
        </Link>
      </main>
    );
  }

  const tokenHash = hashSessionToken(rawToken);
  const record = await passwordResets.get(tokenHash);

  if (!record) {
    return (
      <main className="px-8 py-16 max-w-sm mx-auto">
        <h1 className="text-xl font-medium mb-4">Reset link invalid</h1>
        <p className="text-sm text-red-600 mb-6">{ERROR_MESSAGES.expired}</p>
        <Link
          href="/admin/forgot-password"
          className="text-sm underline text-neutral-600 hover:text-neutral-900"
        >
          Request a new link
        </Link>
      </main>
    );
  }

  return (
    <main className="px-8 py-16 max-w-sm mx-auto">
      <h1 className="text-xl font-medium mb-6">Set new password</h1>
      <form action={completePasswordReset} className="space-y-4">
        <input type="hidden" name="token" value={rawToken} />
        <div>
          <label htmlFor="newPassword" className="block text-sm text-neutral-700 mb-1">
            New password
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full border border-neutral-300 px-3 py-2 text-sm text-neutral-900 bg-white focus:outline-none focus:border-neutral-900"
          />
          <p className="mt-1 text-xs text-neutral-400">Minimum 8 characters</p>
        </div>
        <button
          type="submit"
          className="w-full bg-neutral-900 text-white py-2 text-sm hover:bg-neutral-700 transition-colors"
        >
          Set password
        </button>
      </form>
    </main>
  );
}
