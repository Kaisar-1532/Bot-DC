export async function GET(request) {
  const key = new URL(request.url).searchParams.get("key");
  const { DISCORD_APP_ID, DISCORD_BOT_TOKEN, REGISTER_SECRET } = process.env;

  if (!REGISTER_SECRET || key !== REGISTER_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) {
    return new Response("DISCORD_APP_ID / DISCORD_BOT_TOKEN belum diisi", { status: 500 });
  }

  const commands = [
    {
      name: "roblox",
      description: "Lihat profil user Roblox",
      type: 1,
      options: [
        {
          name: "user",
          description: "Username atau User ID Roblox",
          type: 3,
          required: true,
        },
      ],
      integration_types: [0, 1],
      contexts: [0, 1, 2],
    },
  ];

  const res = await fetch(
    `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    }
  );

  return new Response(`Discord: ${res.status}\n${await res.text()}`, {
    status: res.ok ? 200 : 500,
  });
}
