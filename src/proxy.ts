import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-config";
import { resolveTenant, type Tenant } from "@/lib/tenant";

export function proxy(req: NextRequest) {
  const tenant = resolveTenant(req.headers.get("host"));

  if (!tenant) {
    // API routes handle their own auth — don't block them for unknown hosts.
    // This lets Vercel cron (which may use an internal hostname) reach /api/admin/backup.
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.next();
    }
    return new NextResponse("Not found", { status: 404 });
  }

  const { pathname } = req.nextUrl;
  const isPublicAdminRoute =
    pathname.startsWith("/admin/sign-in") ||
    pathname.startsWith("/admin/forgot-password") ||
    pathname.startsWith("/admin/reset-password");
  if (pathname.startsWith("/admin") && !isPublicAdminRoute) {
    if (!req.cookies.has(SESSION_COOKIE)) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/sign-in";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  // Stamp tenant headers on the request so server components and route handlers
  // can read them via `await headers()` from next/headers.
  const requestHeaders = new Headers(req.headers);
  stampTenant(requestHeaders, tenant);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

function stampTenant(h: Headers, tenant: Tenant): void {
  h.set("x-tenant-id", tenant.id);
  h.set("x-tenant-name", tenant.name);
  h.set("x-tenant-redis-prefix", tenant.redisPrefix);
  h.set("x-tenant-blob-prefix", tenant.blobPrefix);
  h.set("x-tenant-blob-id", tenant.blobId);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
