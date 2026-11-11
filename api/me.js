import { bot, json, avatarUrl } from "../lib/discord.js";
import { getSession } from "../lib/session.js";

// Izin untuk undangan bot: lihat channel, kirim pesan, embed, baca riwayat, kelola role.
const INVITE_PERMS = "268520448";

export async function GET(request) {
  const session = await getSession(request);
  if (!session) return json({ error: "Not logged in" }, 401);

  const r = await bot("/users/@me/guilds?limit=200");
  const inBot = new Set(Array.isArray(r.data) ? r.data.map((g) => g.id) : []);

  const appId = process.env.DISCORD_APP_ID || "";
  return json({
    user: { ...session.user, avatarUrl: avatarUrl(session.user) },
    guilds: session.guilds
      .map((g) => ({ ...g, botIn: inBot.has(g.id) }))
      .sort((a, b) => Number(b.botIn) - Number(a.botIn) || a.name.localeCompare(b.name)),
    inviteUrl: `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot%20applications.commands&permissions=${INVITE_PERMS}`,
  });
}
