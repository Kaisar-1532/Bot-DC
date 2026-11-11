import { bot, isSnowflake, json } from "./discord.js";
import { getSession } from "./session.js";

// Pastikan: sudah login, punya izin kelola server itu, dan bot ada di server.
// Mengembalikan { session, guild } atau sebuah Response error.
export async function requireGuild(request, guildId) {
  if (!isSnowflake(guildId)) return json({ error: "Invalid server" }, 400);
  const session = await getSession(request);
  if (!session) return json({ error: "Not logged in" }, 401);
  if (!session.guilds.some((g) => g.id === guildId)) {
    return json({ error: "You don't have permission to manage this server" }, 403);
  }
  const r = await bot(`/guilds/${guildId}`);
  if (!r.ok) return json({ error: "The bot is not in this server" }, 404);
  return { session, guild: r.data };
}
