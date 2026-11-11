import { cookie, destroySession } from "../../lib/session.js";

export async function POST(request) {
  await destroySession(request);
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", cookie("sid", "", 0));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
