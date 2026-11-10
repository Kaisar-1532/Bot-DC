const { DISCORD_APP_ID, DISCORD_BOT_TOKEN } = process.env;

if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) {
  console.error("Isi DISCORD_APP_ID dan DISCORD_BOT_TOKEN di file .env");
  process.exit(1);
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

console.log(res.status, await res.text());
