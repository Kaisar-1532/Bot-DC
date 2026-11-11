const API = "https://discord.com/api/v10";

export const isSnowflake = (v) => typeof v === "string" && /^\d{15,25}$/.test(v);
export const json = (data, status = 200) => Response.json(data, { status });

// Panggilan REST Discord memakai token bot.
export async function bot(path, { method = "GET", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (roblox-profile-bot, 1.0)",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {}
  }
  return { ok: res.ok, status: res.status, data };
}

export function avatarUrl(user, guildId, memberAvatar) {
  if (memberAvatar && guildId) {
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${memberAvatar}.png?size=256`;
  }
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
  }
  return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
}
