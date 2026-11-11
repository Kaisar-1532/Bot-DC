import { getJSON, setJSON, redis, pipeline } from "../lib/redis.js";
import { bot, isSnowflake, json } from "../lib/discord.js";
import { requireGuild } from "../lib/guard.js";
import { defaultConfig, sanitizeConfig, buildPanelMessage } from "../lib/intro.js";

const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

export async function GET(request) {
  const guildId = new URL(request.url).searchParams.get("guild");
  const ctx = await requireGuild(request, guildId);
  if (ctx instanceof Response) return ctx;
  const gid = ctx.guild.id;

  const [stored, ch, ro, me, ids] = await Promise.all([
    getJSON(`intro:config:${gid}`),
    bot(`/guilds/${gid}/channels`),
    bot(`/guilds/${gid}/roles`),
    bot(`/guilds/${gid}/members/${process.env.DISCORD_APP_ID}`),
    redis(["ZREVRANGE", `intro:idx:${gid}`, "0", "49"]),
  ]);

  const rawCards = ids.length
    ? await redis(["MGET", ...ids.map((u) => `intro:card:${gid}:${u}`)])
    : [];
  const cards = rawCards
    .map(parse)
    .filter(Boolean)
    .map((c) => ({
      userId: c.userId,
      name: c.name,
      username: c.username,
      summary: c.summary,
      updatedAt: c.updatedAt,
      url: `https://discord.com/channels/${gid}/${c.channelId}/${c.messageId}`,
    }));

  const roles = Array.isArray(ro.data) ? ro.data : [];
  const myRoles = Array.isArray(me.data?.roles) ? me.data.roles : [];
  const botTop = roles.filter((r) => myRoles.includes(r.id)).reduce((m, r) => Math.max(m, r.position), 0);

  return json({
    guild: { id: gid, name: ctx.guild.name },
    config: stored ?? { ...defaultConfig(), guildName: ctx.guild.name },
    channels: (Array.isArray(ch.data) ? ch.data : [])
      .filter((c) => c.type === 0 || c.type === 5)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, name: c.name })),
    roles: roles
      .filter((r) => r.id !== gid && !r.managed)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name, position: r.position })),
    botTop,
    cards,
  });
}

export async function POST(request) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    return json({ error: "Bad request" }, 400);
  }
  const url = new URL(request.url);
  const ctx = await requireGuild(request, url.searchParams.get("guild"));
  if (ctx instanceof Response) return ctx;
  const gid = ctx.guild.id;
  const action = url.searchParams.get("action");
  const key = `intro:config:${gid}`;

  let body = {};
  try {
    body = await request.json();
  } catch {}

  if (action === "save") {
    const prev = await getJSON(key);
    let cfg;
    try {
      cfg = sanitizeConfig(body, prev);
    } catch (e) {
      return json({ error: e.message }, 400);
    }
    cfg.guildName = ctx.guild.name;
    await setJSON(key, cfg);
    return json({ config: cfg });
  }

  if (action === "post") {
    const cfg = await getJSON(key);
    if (!cfg?.channelId) return json({ error: "Pick an intro channel and save first." }, 400);
    cfg.guildName = ctx.guild.name;

    if (cfg.panelChannelId && cfg.panelMessageId) {
      await bot(`/channels/${cfg.panelChannelId}/messages/${cfg.panelMessageId}`, { method: "DELETE" });
    }
    const r = await bot(`/channels/${cfg.channelId}/messages`, {
      method: "POST",
      body: buildPanelMessage(cfg, ctx.guild.name),
    });
    if (!r.ok) {
      return json(
        { error: `Discord refused the panel: ${r.data?.message || r.status}. Check the bot's permissions in that channel and the emoji.` },
        502
      );
    }
    cfg.panelChannelId = r.data.channel_id || cfg.channelId;
    cfg.panelMessageId = r.data.id;
    await setJSON(key, cfg);
    return json({ ok: true, url: `https://discord.com/channels/${gid}/${cfg.panelChannelId}/${cfg.panelMessageId}` });
  }

  if (action === "remove") {
    if (!isSnowflake(body.userId)) return json({ error: "Invalid user" }, 400);
    const card = await getJSON(`intro:card:${gid}:${body.userId}`);
    if (card?.messageId) {
      await bot(`/channels/${card.channelId}/messages/${card.messageId}`, { method: "DELETE" });
    }
    await pipeline([
      ["DEL", `intro:card:${gid}:${body.userId}`],
      ["ZREM", `intro:idx:${gid}`, body.userId],
    ]);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
}
