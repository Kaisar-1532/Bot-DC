import { getJSON, setJSON, redis, pipeline } from "../lib/redis.js";
import { bot, json, isSnowflake } from "../lib/discord.js";
import { requireGuild } from "../lib/guard.js";
import { defaultConfig, sanitizeConfig, buildPanelMessage, getConfig, cardKey } from "../lib/intro.js";

// GET  /api/intro?guild=ID                 -> config + daftar kartu + channel + role
// POST /api/intro?guild=ID&action=save     -> simpan config
// POST /api/intro?guild=ID&action=post     -> kirim / kirim ulang panel
// POST /api/intro?guild=ID&action=remove   -> hapus kartu perkenalan seorang member

export async function GET(request) {
  const gid = new URL(request.url).searchParams.get("guild");
  const g = await requireGuild(request, gid);
  if (g instanceof Response) return g;
  const { guild } = g;

  const [saved, chRes, roleRes, meRes, ids] = await Promise.all([
    getConfig(gid),
    bot(`/guilds/${gid}/channels`),
    bot(`/guilds/${gid}/roles`),
    bot(`/guilds/${gid}/members/${process.env.DISCORD_APP_ID}`),
    redis(["ZREVRANGE", `intro:idx:${gid}`, "0", "99"]),
  ]);

  const config = { ...defaultConfig(), ...(saved || {}), guildName: guild.name };

  const channels = (Array.isArray(chRes.data) ? chRes.data : [])
    .filter((c) => c.type === 0 || c.type === 5)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }));

  const allRoles = Array.isArray(roleRes.data) ? roleRes.data : [];
  const roles = allRoles
    .filter((r) => r.id !== gid && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, position: r.position }));

  const myRoleIds = new Set(meRes.data?.roles || []);
  const botTop = allRoles.filter((r) => myRoleIds.has(r.id)).reduce((m, r) => Math.max(m, r.position), 0);

  let cards = [];
  if (ids?.length) {
    const rows = await pipeline(ids.map((uid) => ["GET", cardKey(gid, uid)]));
    cards = rows
      .map((raw) => {
        try { return raw ? JSON.parse(raw) : null; } catch { return null; }
      })
      .filter(Boolean)
      .map((c) => ({
        userId: c.userId,
        name: c.name,
        summary: c.summary,
        updatedAt: c.updatedAt,
        url: `https://discord.com/channels/${gid}/${c.channelId}/${c.messageId}`,
      }));
  }

  return json({ config, cards, guild: { id: gid, name: guild.name }, channels, roles, botTop });
}

export async function POST(request) {
  const params = new URL(request.url).searchParams;
  const gid = params.get("guild");
  const action = params.get("action");
  const g = await requireGuild(request, gid);
  if (g instanceof Response) return g;
  const { guild } = g;

  let body = {};
  try { body = await request.json(); } catch {}

  if (action === "save") {
    const prev = await getConfig(gid);
    let cfg;
    try {
      cfg = sanitizeConfig(body, prev);
    } catch (e) {
      return json({ error: e.message }, 400);
    }
    cfg.guildName = guild.name;
    await setJSON(`intro:config:${gid}`, cfg);
    return json({ config: cfg });
  }

  if (action === "post") {
    const cfg = await getConfig(gid);
    if (!cfg?.channelId) return json({ error: "Pick an intro channel first." }, 400);
    const r = await bot(`/channels/${cfg.channelId}/messages`, {
      method: "POST",
      body: buildPanelMessage(cfg, guild.name),
    });
    if (!r.ok) return json({ error: "I couldn't post in that channel. Check my permissions there." }, 400);
    if (cfg.panelChannelId && cfg.panelMessageId) {
      await bot(`/channels/${cfg.panelChannelId}/messages/${cfg.panelMessageId}`, { method: "DELETE" }).catch(() => {});
    }
    cfg.guildName = guild.name;
    cfg.panelChannelId = r.data.channel_id || cfg.channelId;
    cfg.panelMessageId = r.data.id;
    await setJSON(`intro:config:${gid}`, cfg);
    return json({ ok: true, config: cfg });
  }

  if (action === "remove") {
    const uid = body?.userId;
    if (!isSnowflake(uid)) return json({ error: "Invalid member" }, 400);
    const card = await getJSON(cardKey(gid, uid));
    if (card?.channelId && card?.messageId) {
      await bot(`/channels/${card.channelId}/messages/${card.messageId}`, { method: "DELETE" }).catch(() => {});
    }
    await pipeline([["DEL", cardKey(gid, uid)], ["ZREM", `intro:idx:${gid}`, uid]]);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
}
