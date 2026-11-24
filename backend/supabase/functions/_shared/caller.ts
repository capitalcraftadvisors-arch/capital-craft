// Is this request from a signed-in person? (0135)
//
// The gateway (verify_jwt = true) has already checked the token's signature and,
// when it has one, its expiry. It also lets the public anon key through, so here
// we also need a person's login: role "authenticated", a business, and an expiry
// (or the server's own service-role key, which is secret).
export function signedIn(req: Request): boolean {
  const h = req.headers.get("authorization") ?? "";
  const token = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const c = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    if (c.role === "service_role") return true;
    return c.role === "authenticated" && typeof c.business_id === "string" && !!c.business_id
      && typeof c.exp === "number" && c.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}
