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
  return {
    user,
    friends: friends?.count,
    followers: followers?.count,
    followings: followings?.count,
    groups: Array.isArray(groups?.data) ? groups.data.length : undefined,
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

function buildEmbed({ user, friends, followers, followings, groups, avatar }) {
  const createdMs = new Date(user.created).getTime();
  const created = Math.floor(createdMs / 1000);
  const days = Math.floor((Date.now() - createdMs) / 86400000);
  const profileUrl = `https://www.roblox.com/users/${user.id}/profile`;

  const bio = (user.description ?? "").trim().slice(0, 300);
  const bioText = bio
    ? bio.split(/\r?\n/).filter(Boolean).join(" ")
    : "Tidak ada bio.";

  const description = [
    `### [${user.displayName}](${profileUrl}) (\`@${user.name}\`)`,
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

function buildButtons(user) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          label: "Buka Profil Roblox",
          url: `https://www.roblox.com/users/${user.id}/profile`,
        },
      ],
    },
  ];
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

    return reply("", {
      embeds: [buildEmbed(profile)],
      components: buildButtons(profile.user),
    });
  }

  return reply("Perintah tidak dikenal.", { flags: 64 });
}

export function GET() {
  return new Response("Roblox Profile Bot aktif ✅");
}
