import { createPublicKey, verify } from "node:crypto";

const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const CHANNEL_MESSAGE = 4;

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
  const [user, friends, followers, followings, thumb] = await Promise.all([
    robloxFetch(`https://users.roblox.com/v1/users/${userId}`),
    robloxFetch(`https://friends.roblox.com/v1/users/${userId}/friends/count`),
    robloxFetch(`https://friends.roblox.com/v1/users/${userId}/followers/count`),
    robloxFetch(`https://friends.roblox.com/v1/users/${userId}/followings/count`),
    robloxFetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`
    ),
  ]);
  if (!user) return null;
  return {
    user,
    friends: friends?.count,
    followers: followers?.count,
    followings: followings?.count,
    avatar: thumb?.data?.[0]?.imageUrl ?? null,
  };
}

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("id-ID") : "—");

function buildEmbed({ user, friends, followers, followings, avatar }) {
  const created = Math.floor(new Date(user.created).getTime() / 1000);
  const badges = [];
  if (user.hasVerifiedBadge) badges.push("✅ Verified");
  if (user.isBanned) badges.push("🚫 Banned");

  return {
    title: `${user.displayName} (@${user.name})${user.hasVerifiedBadge ? " ✅" : ""}`,
    url: `https://www.roblox.com/users/${user.id}/profile`,
    description: user.description?.trim()
      ? user.description.slice(0, 500)
      : "*Tidak ada deskripsi.*",
    color: user.isBanned ? 0xed4245 : 0x00a2ff,
    thumbnail: avatar ? { url: avatar } : undefined,
    fields: [
      { name: "User ID", value: `\`${user.id}\``, inline: true },
      { name: "Dibuat", value: `<t:${created}:D>\n(<t:${created}:R>)`, inline: true },
      { name: "Status", value: badges.join(" • ") || "Normal", inline: true },
      { name: "Teman", value: fmt(friends), inline: true },
      { name: "Pengikut", value: fmt(followers), inline: true },
      { name: "Mengikuti", value: fmt(followings), inline: true },
    ],
    footer: { text: "Data dari Roblox API" },
    timestamp: new Date().toISOString(),
  };
}

function reply(content, extra = {}) {
  return Response.json({ type: CHANNEL_MESSAGE, data: { content, ...extra } });
}

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

  if (interaction.type === APPLICATION_COMMAND && interaction.data.name === "roblox") {
    const input = interaction.data.options?.find((o) => o.name === "user")?.value?.trim();
    if (!input) return reply("Masukkan username atau User ID Roblox.", { flags: 64 });

    const userId = await findUserId(input);
    if (!userId) return reply(`❌ User **${input}** tidak ditemukan.`, { flags: 64 });

    const profile = await getProfile(userId);
    if (!profile) {
      return reply("❌ Gagal mengambil data dari Roblox. Coba lagi sebentar.", { flags: 64 });
    }

    return reply("", { embeds: [buildEmbed(profile)] });
  }

  return reply("Perintah tidak dikenal.", { flags: 64 });
}

export function GET() {
  return new Response("Roblox Profile Bot aktif ✅");
}
