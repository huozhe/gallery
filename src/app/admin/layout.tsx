import Link from "next/link";
import { getSession } from "@/lib/auth";
import { signOut } from "./actions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-8 py-4 border-b border-neutral-200 bg-neutral-50">
        <div className="flex items-center gap-6">
          <Link href="/admin" className="text-sm font-medium tracking-tight">
            Admin
          </Link>
          <Link href="/" className="text-sm text-neutral-600 hover:text-neutral-900">
            View site
          </Link>
        </div>
        {session && (
          <div className="flex items-center gap-4 text-sm text-neutral-600">
            <span>{session.user.email}</span>
            <form action={signOut}>
              <button className="underline hover:text-neutral-900" type="submit">
                Sign out
              </button>
            </form>
          </div>
        )}
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
