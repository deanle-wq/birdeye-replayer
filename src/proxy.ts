import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional site-wide password. Set SITE_PASSWORD on a public deployment so a
 * shared link cannot spend your Birdeye compute units; leave it unset locally.
 * Any username works, the password is checked against SITE_PASSWORD.
 */
export function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();

  const [scheme, encoded] = (request.headers.get("authorization") ?? "").split(" ");
  if (scheme === "Basic" && encoded) {
    let supplied = "";
    try {
      const decoded = atob(encoded);
      supplied = decoded.slice(decoded.indexOf(":") + 1);
    } catch {
      supplied = "";
    }
    if (constantTimeEqual(supplied, password)) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Birdeye Replayer", charset="UTF-8"' },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
