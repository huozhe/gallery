import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { signIn } from "../actions";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Email or password is incorrect.",
  "rate-limited": "Too many attempts. Wait a minute and try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  const session = await getSession();
  if (session) redirect(next && next.startsWith("/admin") ? next : "/admin");

  return (
    <main className="px-8 py-16 max-w-sm mx-auto">
      <h1 className="text-xl font-medium mb-6">Sign in</h1>
      {error && (
        <p className="mb-4 text-sm text-red-700 border border-red-200 bg-red-50 p-3">
          {ERROR_MESSAGES[error] ?? "Sign-in failed."}
        </p>
      )}
      <form action={signIn} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm text-neutral-700 mb-1">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full border border-neutral-300 px-3 py-2 text-sm text-neutral-900 bg-white focus:outline-none focus:border-neutral-900"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm text-neutral-700 mb-1">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full border border-neutral-300 px-3 py-2 text-sm text-neutral-900 bg-white focus:outline-none focus:border-neutral-900"
          />
        </div>
        {next && <input type="hidden" name="next" value={next} />}
        <button
          type="submit"
          className="w-full bg-neutral-900 text-white py-2 text-sm hover:bg-neutral-700 transition-colors"
        >
          Sign in
        </button>
      </form>
      <p className="mt-6 text-xs text-neutral-500">
        <Link href="/admin/forgot-password" className="underline hover:text-neutral-700">
          Forgot your password?
        </Link>
      </p>
    </main>
  );
}
