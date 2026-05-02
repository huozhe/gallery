import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-config";

// Edge-runtime proxy (Next 16's renamed middleware): cheap cookie-presence
// check on /admin/*. Full session validation (DB lookup) happens in admin
// pages/actions via requireSession().
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin/sign-in")) return NextResponse.next();

  if (pathname.startsWith("/admin")) {
    const hasCookie = req.cookies.has(SESSION_COOKIE);
    if (!hasCookie) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/sign-in";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/admin/:path*",
};
