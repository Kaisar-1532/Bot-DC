import { getJSON, setJSON, redis, pipeline } from "./redis.js";
import { bot, avatarUrl } from "./discord.js";

export const MAX_QUESTIONS = 5;
const EPHEMERAL = 64;

export function defaultConfig() {
  return {
    enabled: true,
    channelId: "",
    roleId: "",
    pingRoleId: "",
    questions: [
      { label: "Nickname", placeholder: "What should we call you?", emoji: "✏️", required: true, style: 1, maxLength: 50 },
      { label: "Age / Pronouns", placeholder: "e.g. 21 / she", emoji: "🎂", required: true, style: 1, maxLength: 50 },
      { label: "Come from", placeholder: "City or country", emoji: "🌍", required: true, style: 1, maxLength: 80 },
      { label: "Hobbies", placeholder: "What do you do for fun?", emoji: "🎧", required: false, style: 2, maxLength: 300 },
      { label: "Little fun fact about me", placeholder: "Anything. Whatever.", emoji: "✨", required: false, style: 2, maxLength: 300 },
    ],
    panel: {
      title: "{server} • Introductions",
      buttonLabel: "Introduction",
      emoji: "📝",
      message: "New here? Hit the button and tell us a bit about yourself.",
      footer: "5 quick questions · you can edit yours any time by pressing the button again",
      color: "#5865f2",
    },
    card: { title: "{name}" },
    cooldown: 60,
    keepPanelBottom: true,
    guildName: "",
    panelChannelId: "",
    panelMessageId: "",
  };
}

const str = (v, max, fb = "") => (typeof v === "string" ? v.trim().slice(0, max) : fb);
const int = (v, min, max, fb) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
};
const sf = (v) => (typeof v === "string" && /^\d{15,25}$/.test(v) ? v : "");

// Bersihkan & batasi input dari web panel sebelum disimpan.
export function sanitizeConfig(input, prev) {
  const d = defaultConfig();
  const src = input && typeof input === "object" ? input : {};
  const questions = (Array.isArray(src.questions) ? src.questions.slice(0, MAX_QUESTIONS) : [])
    .map((q) => {
      const style = q?.style === 2 ? 2 : 1;
      return {
        label: str(q?.label, 45),
        placeholder: str(q?.placeholder, 100),
        emoji: str(q?.emoji, 16),
        required: q?.required === true,
        style,
        maxLength: int(q?.maxLength, 1, style === 2 ? 1000 : 200, style === 2 ? 500 : 100),
      };
    })
    .filter((q) => q.label);
  if (!questions.length) throw new Error("Add at least one question (it needs a label).");

  const p = src.panel && typeof src.panel === "object" ? src.panel : {};
  const c = src.card && typeof src.card === "object" ? src.card : {};
  return {
    enabled: src.enabled !== false,
    channelId: sf(src.channelId),
    roleId: sf(src.roleId),
    pingRoleId: sf(src.pingRoleId),
    questions,
    panel: {
      title: str(p.title, 100),
      buttonLabel: str(p.buttonLabel, 80),
      emoji: str(p.emoji, 16),
      message: str(p.message, 2000),
      footer: str(p.footer, 200),
      color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : d.panel.color,
    },
    card: { title: str(c.title, 200) },
    cooldown: int(src.cooldown, 0, 86400, d.cooldown),
    keepPanelBottom: src.keepPanelBottom !== false,
    guildName: prev?.guildName || "",
    panelChannelId: prev?.panelChannelId || "",
    panelMessageId: prev?.panelMessageId || "",
  };
}

export const fill = (t, v) =>
  String(t || "")
    .split("{name}").join(v.name)
    .split("{username}").join(v.username)
    .split("{server}").join(v.server);

const colorInt = (hex) => parseInt(String(hex || "#5865f2").slice(1), 16);

export function buildPanelMessage(cfg, guildName) {
  const p = cfg.panel;
  return {
    embeds: [
      {
        title: fill(p.title, { name: "", username: "", server: guildName || "this server" }).slice(0, 256) || undefined,
        description: p.message || undefined,
        color: colorInt(p.color),
        footer: p.footer ? { text: p.footer } : undefined,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            label: p.buttonLabel || "Introduction",
            custom_id: "intro:open",
            emoji: p.emoji ? { name: p.emoji } : undefined,
          },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

export function buildCard(cfg, { user, member, guildId }, answers, guildName) {
  const name = member?.nick || user.global_name || user.username;
  const blocks = [];
  cfg.questions.forEach((q, i) => {
    const a = (answers[i] || "").trim();
    if (a) blocks.push(`• ${q.emoji || "•"} · **${q.label}:**\n${a}`);
  });
  return {
    title: fill(cfg.card.title, { name, username: user.username, server: guildName || "" }).slice(0, 256) || undefined,
    description: (blocks.join("\n\n") || "—").slice(0, 4000),
    color: colorInt(cfg.panel.color),
    thumbnail: { url: avatarUrl(user, guildId, member?.avatar) },
    timestamp: new Date().toISOString(),
  };
}

const ephemeral = (content) => ({
  type: 4,
  data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
});

export const getConfig = (gid) => getJSON(`intro:config:${gid}`);
export const cardKey = (gid, uid) => `intro:card:${gid}:${uid}`;

export function cooldownLeft(cfg, card) {
  if (!card || !cfg.cooldown) return 0;
  const left = Math.ceil((card.lastEditAt + cfg.cooldown * 1000 - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

// Posting ulang panel di bawah kartu terbaru, lalu hapus panel lama.
// Kunci singkat mencegah dua intro bersamaan membuat panel ganda.
async function repostPanel(gid, cfg) {
  const lock = `intro:lock:${gid}`;
  if ((await redis(["SET", lock, "1", "NX", "PX", "5000"])) !== "OK") return;
  try {
    const r = await bot(`/channels/${cfg.channelId}/messages`, {
      method: "POST",
      body: buildPanelMessage(cfg, cfg.guildName),
    });
    if (!r.ok) return; // panel lama tetap ada kalau posting gagal
    const fresh = (await getConfig(gid)) || cfg;
    const oldChannel = fresh.panelChannelId;
    const oldMessage = fresh.panelMessageId;
    fresh.panelChannelId = r.data.channel_id || cfg.channelId;
    fresh.panelMessageId = r.data.id;
    await Promise.all([
      oldChannel && oldMessage
        ? bot(`/channels/${oldChannel}/messages/${oldMessage}`, { method: "DELETE" })
        : null,
      setJSON(`intro:config:${gid}`, fresh),
    ]);
  } finally {
    await redis(["DEL", lock]);
  }
}

// Tombol "Introduction" ditekan -> tampilkan form (modal).
export async function handleIntroOpen(interaction) {
  const gid = interaction.guild_id;
  const user = interaction.member?.user;
  if (!gid || !user) return ephemeral("This only works inside a server.");

  const cfg = await getConfig(gid);
  if (!cfg || !cfg.enabled || !cfg.channelId) {
    return ephemeral("Introductions are currently turned off in this server.");
  }
  const card = await getJSON(cardKey(gid, user.id));
  const wait = cooldownLeft(cfg, card);
  if (wait > 0) return ephemeral(`⏳ Please wait ${wait}s before editing your introduction again.`);

  return {
    type: 9,
    data: {
      custom_id: "intro:submit",
      title: "Introduction",
      components: cfg.questions.map((q, i) => ({
        type: 1,
        components: [
          {
            type: 4,
            custom_id: `q${i}`,
            label: q.label.slice(0, 45),
            style: q.style === 2 ? 2 : 1,
            placeholder: q.placeholder || undefined,
            required: q.required === true,
            max_length: q.maxLength,
            value: card?.answers?.[i] ? String(card.answers[i]).slice(0, q.maxLength) : undefined,
          },
        ],
      })),
    },
  };
}

function modalValue(interaction, customId) {
  for (const row of interaction.data.components || []) {
    for (const c of row.components || []) if (c.custom_id === customId) return c.value || "";
  }
  return "";
}

// Form dikirim -> posting kartu baru, atau edit kartu lama.
export async function handleIntroSubmit(interaction) {
  const gid = interaction.guild_id;
  const member = interaction.member;
  const user = member?.user;
  if (!gid || !user) return ephemeral("This only works inside a server.");

  const cfg = await getConfig(gid);
  if (!cfg || !cfg.enabled || !cfg.channelId) {
    return ephemeral("Introductions are currently turned off in this server.");
  }
  const answers = cfg.questions.map((_, i) => modalValue(interaction, `q${i}`).trim());
  if (cfg.questions.some((q, i) => q.required && !answers[i])) {
    return ephemeral("Please answer all required questions.");
  }

  const prev = await getJSON(cardKey(gid, user.id));
  const wait = cooldownLeft(cfg, prev);
  if (wait > 0) return ephemeral(`⏳ Please wait ${wait}s before editing your introduction again.`);

  const embed = buildCard(cfg, { user, member, guildId: gid }, answers, cfg.guildName);

  let msg = null;
  let isNew = true;
  if (prev?.messageId) {
    const r = await bot(`/channels/${prev.channelId}/messages/${prev.messageId}`, {
      method: "PATCH",
      body: { embeds: [embed], allowed_mentions: { parse: [] } },
    });
    if (r.ok) {
      msg = r.data;
      isNew = false;
    }
  }
  if (!msg) {
    const r = await bot(`/channels/${cfg.channelId}/messages`, {
      method: "POST",
      body: {
        content: cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : undefined,
        embeds: [embed],
        allowed_mentions: cfg.pingRoleId ? { roles: [cfg.pingRoleId] } : { parse: [] },
      },
    });
    if (!r.ok) {
      return ephemeral("❌ I couldn't post in the introductions channel. Ask an admin to check my permissions there.");
    }
    msg = r.data;
  }

  const now = Date.now();
  const name = member.nick || user.global_name || user.username;
  const summary = cfg.questions
    .map((q, i) => (answers[i] ? `${q.label}: ${answers[i]}` : ""))
    .filter(Boolean)
    .slice(0, 3)
    .join(" · ")
    .replace(/\s+/g, " ")
    .slice(0, 200);
  const record = {
    userId: user.id,
    username: user.username,
    name,
    messageId: msg.id,
    channelId: msg.channel_id || cfg.channelId,
    answers,
    summary,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
    lastEditAt: now,
  };

  const jobs = [
    pipeline([
      ["SET", cardKey(gid, user.id), JSON.stringify(record)],
      ["ZADD", `intro:idx:${gid}`, String(prev?.createdAt || now), user.id],
    ]),
  ];
  if (cfg.roleId && isNew) {
    jobs.push(bot(`/guilds/${gid}/members/${user.id}/roles/${cfg.roleId}`, { method: "PUT" }));
  }
  if (isNew && cfg.keepPanelBottom !== false) {
    jobs.push(repostPanel(gid, cfg).catch((e) => console.error("repostPanel", e)));
  }
  await Promise.all(jobs);

  const link = `https://discord.com/channels/${gid}/${record.channelId}/${record.messageId}`;
  return ephemeral(isNew ? `✅ Your introduction is posted! ${link}` : `✅ Your introduction was updated! ${link}`);
}
