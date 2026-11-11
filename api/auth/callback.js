import { cookie, readCookie, createSession, SESSION_TTL } from "../../lib/session.js";

const API = "https://discord.com/api/v10";
const ADMIN = 0x8n;
const MANAGE_GUILD = 0x20n;

function back(path, extraCookies = []) {
  const headers = new Headers({ Location: path });
  headers.append("Set-Cookie", cookie("oauth_state", "", 0));
  for (const c of extraCookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}
const fail = (msg) => back(`/?error=${encodeURIComponent(msg)}`);

export async function GET(request) {
  const url = new URL(request.url);
  const origin = (process.env.PUBLIC_URL || url.origin).replace(/\/$/, "");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state || state !== readCookie(request, "oauth_state")) {
    return fail("Login expired, please try again.");
  }

  const tok = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_APP_ID || "",
      client_secret: process.env.DISCORD_CLIENT_SECRET || "",
      grant_type: "authorization_code",
      code,
      redirect_uri: `${origin}/api/auth/callback`,
    }),
  });
  if (!tok.ok) return fail("Discord login failed. Check the redirect URL and client secret.");
  const { access_token } = await tok.json();

  const auth = { Authorization: `Bearer ${access_token}` };
  const [meRes, gRes] = await Promise.all([
    fetch(`${API}/users/@me`, { headers: auth }),
    fetch(`${API}/users/@me/guilds`, { headers: auth }),
  ]);
  if (!meRes.ok || !gRes.ok) return fail("Could not read your Discord account.");
  const me = await meRes.json();
  const guilds = (await gRes.json())
    .filter((g) => g.owner || (BigInt(g.permissions || "0") & (ADMIN | MANAGE_GUILD)) !== 0n)
    .map(({ id, name, icon }) => ({ id, name, icon }));

  const sid = await createSession({
    user: {
      id: me.id,
      name: me.global_name || me.username,
      avatar: me.avatar || null,
    },
    guilds,
  });
  return back("/", [cookie("sid", sid, SESSION_TTL)]);
}
