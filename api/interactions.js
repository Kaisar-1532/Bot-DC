import { createPublicKey, verify } from "node:crypto";
import { handleIntroOpen, handleIntroSubmit } from "../lib/intro.js";

const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const MODAL_SUBMIT = 5;
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const UPDATE_MESSAGE = 7;

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function verifyDiscordSignature(rawBody, signature, timestamp, publicKeyHex) {
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// ---------- Roblox ----------
async function robloxFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2300);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function findUserId(input) {
  if (/^\d+$/.test(input)) return Number(input);
  const data = await robloxFetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [input], excludeBannedUsers: false }),
  });
  return data?.data?.[0]?.id ?? null;
}

async function getProfile(userId) {
  const [user, friends, followers, followings, groups, thumb] = await Promise.all([
    robloxFetch(`https://users.roblox.com/v1/users/${userId}`),
    robloxFetch(`https://friends.roblox.com/v1/users/${userId}/friends/count`),
    robloxFetch(`https://friends.roblox.com/v1/users/${userId}/followers/count`),
    robloxFetch(`https://friends.roblox.com/v1/users/${userId}/followings/count`),
    robloxFetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`),
    robloxFetch(
      `https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`
    ),
  ]);
  if (!user) return null;
  const groupList = Array.isArray(groups?.data) ? groups.data : null;
  return {
    user,
    friends: friends?.count,
    followers: followers?.count,
    followings: followings?.count,
    groupList,
    groups: groupList ? groupList.length : undefined,
    avatar: thumb?.data?.[0]?.imageUrl ?? null,
  };
}

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("id-ID") : "—");
const yesNo = (v) => (v ? "Yes" : "No");

function ageLabel(days) {
  if (days < 30) return "New (<1 month)";
  if (days < 365) return "Growing (<1 year)";
  if (days < 730) return "Experienced (1+ year)";
  return "Established (2+ years)";
}

function heading(user) {
  const url = `https://www.roblox.com/users/${user.id}/profile`;
  return `### [${user.displayName}](${url}) (\`@${user.name}\`)`;
}

function buildOverview(p) {
  const { user, friends, followers, followings, groups, avatar } = p;
  const createdMs = new Date(user.created).getTime();
  const created = Math.floor(createdMs / 1000);
  const days = Math.floor((Date.now() - createdMs) / 86400000);

  const bio = (user.description ?? "").trim().slice(0, 300);
  const bioText = bio ? bio.split(/\r?\n/).filter(Boolean).join(" ") : "Tidak ada bio.";

  const description = [
    heading(user),
    `> **User ID:** \`${user.id}\``,
    `> **Bio:** ${bioText}`,
    "",
    `**Joined:** <t:${created}:D> (<t:${created}:R>)`,
    `**Account Age:** \`${fmt(days)} days\` (\`${ageLabel(days)}\`)`,
    `**Friends:** \`${fmt(friends)}\` | **Followers:** \`${fmt(followers)}\` | **Following:** \`${fmt(followings)}\``,
    `**Verified:** \`${yesNo(user.hasVerifiedBadge)}\` | **Banned:** \`${yesNo(user.isBanned)}\` | **Groups:** \`${fmt(groups)}\``,
  ].join("\n");

  return {
    description,
    color: user.isBanned ? 0xed4245 : 0x00a2ff,
    image: avatar ? { url: avatar } : undefined,
    footer: { text: "Data dari Roblox API" },
    timestamp: new Date().toISOString(),
  };
}

function buildGroups(p) {
  const { user, groupList } = p;
  const MAX = 25;
  let body;
  if (!groupList) {
    body = "Gagal mengambil daftar grup. Coba lagi sebentar.";
  } else if (groupList.length === 0) {
    body = "Tidak bergabung di grup mana pun.";
  } else {
    const lines = groupList.slice(0, MAX).map((g) => `• **${g.group.name}** — \`${g.role.name}\``);
    if (groupList.length > MAX) lines.push(`…dan ${groupList.length - MAX} grup lainnya`);
    body = lines.join("\n");
  }
  return {
    description: [heading(user), `**Groups (${fmt(groupList?.length)})**`, "", body].join("\n").slice(0, 4000),
    color: 0x00a2ff,
    footer: { text: "Data dari Roblox API" },
    timestamp: new Date().toISOString(),
  };
}

function buildButtons(p, active) {
  const { user, avatar, groups } = p;
  const row = [
    { type: 2, style: 2, label: "Overview", custom_id: `overview:${user.id}`, disabled: active === "overview" },
    { type: 2, style: 2, label: `Groups (${fmt(groups)})`, custom_id: `groups:${user.id}`, disabled: active === "groups" },
    { type: 2, style: 5, label: "Profile", url: `https://www.roblox.com/users/${user.id}/profile` },
  ];
  if (avatar) row.push({ type: 2, style: 5, label: "Avatar", url: avatar });
  return [{ type: 1, components: row }];
}

function reply(content, extra = {}) {
  return Response.json({ type: CHANNEL_MESSAGE, data: { content, ...extra } });
}

// ---------- Handler utama ----------
export async function POST(request) {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const rawBody = await request.text();

  if (
    !signature ||
    !timestamp ||
    !verifyDiscordSignature(rawBody, signature, timestamp, process.env.DISCORD_PUBLIC_KEY ?? "")
  ) {
    return new Response("Invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(rawBody);

  if (interaction.type === PING) {
    return Response.json({ type: PONG });
  }

  // Slash command /roblox
  if (interaction.type === APPLICATION_COMMAND && interaction.data.name === "roblox") {
    const input = interaction.data.options?.find((o) => o.name === "user")?.value?.trim();
    if (!input) return reply("Masukkan username atau User ID Roblox.", { flags: 64 });

    const userId = await findUserId(input);
    if (!userId) return reply(`❌ User **${input}** tidak ditemukan.`, { flags: 64 });

    const profile = await getProfile(userId);
    if (!profile) {
      return reply("❌ Gagal mengambil data dari Roblox. Coba lagi sebentar.", { flags: 64 });
    }
    return reply("", {
      embeds: [buildOverview(profile)],
      components: buildButtons(profile, "overview"),
    });
  }

  // Tombol
  if (interaction.type === MESSAGE_COMPONENT) {
    const customId = String(interaction.data.custom_id);

    if (customId === "intro:open") {
      try {
        return Response.json(await handleIntroOpen(interaction));
      } catch (e) {
        console.error(e);
        return reply("Something went wrong. Please try again.", { flags: 64 });
      }
    }

    const [view, id] = customId.split(":");
    if ((view === "overview" || view === "groups") && /^\d+$/.test(id)) {
      const profile = await getProfile(id);
      if (!profile) {
        return reply("❌ Gagal mengambil data dari Roblox. Coba lagi sebentar.", { flags: 64 });
      }
      const embed = view === "groups" ? buildGroups(profile) : buildOverview(profile);
      return Response.json({
        type: UPDATE_MESSAGE,
        data: { content: "", embeds: [embed], components: buildButtons(profile, view) },
      });
    }
  }

  // Form Introduction dikirim
  if (interaction.type === MODAL_SUBMIT && interaction.data.custom_id === "intro:submit") {
    try {
      return Response.json(await handleIntroSubmit(interaction));
    } catch (e) {
      console.error(e);
      return reply("Something went wrong. Please try again.", { flags: 64 });
    }
  }

  return reply("Perintah tidak dikenal.", { flags: 64 });
}

export function GET() {
  return new Response("Roblox Profile Bot aktif ✅");
}
