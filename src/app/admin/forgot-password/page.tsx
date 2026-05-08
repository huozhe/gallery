import Link from "next/link";
import { requestPasswordReset } from "../actions";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  if (sent) {
    return (
      <main className="px-8 py-16 max-w-sm mx-auto">
        <h1 className="text-xl font-medium mb-4">Check your email</h1>
        <p className="text-sm text-neutral-600 mb-6">
          If that email address is registered, you&apos;ll receive a reset link shortly. The link
          expires in 1 hour.
        </p>
        <Link href="/admin/sign-in" className="text-sm underline text-neutral-600 hover:text-neutral-900">
          Back to sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="px-8 py-16 max-w-sm mx-auto">
      <h1 className="text-xl font-medium mb-6">Reset password</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Enter your admin email and we&apos;ll send you a reset link.
      </p>
      <form action={requestPasswordReset} className="space-y-4">
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
        <button
          type="submit"
          className="w-full bg-neutral-900 text-white py-2 text-sm hover:bg-neutral-700 transition-colors"
        >
          Send reset link
        </button>
      </form>
      <p className="mt-6 text-xs text-neutral-500">
        <Link href="/admin/sign-in" className="underline hover:text-neutral-700">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
