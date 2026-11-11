import { randomBytes } from "node:crypto";
import { cookie } from "../../lib/session.js";

export function GET(request) {
  const origin = (process.env.PUBLIC_URL || new URL(request.url).origin).replace(/\/$/, "");
  const state = randomBytes(16).toString("hex");
  const qs = new URLSearchParams({
    client_id: process.env.DISCORD_APP_ID || "",
    redirect_uri: `${origin}/api/auth/callback`,
    response_type: "code",
    scope: "identify guilds",
    state,
    prompt: "none",
  });
  const headers = new Headers({ Location: `https://discord.com/oauth2/authorize?${qs}` });
  headers.append("Set-Cookie", cookie("oauth_state", state, 600));
  return new Response(null, { status: 302, headers });
}
