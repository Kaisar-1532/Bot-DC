const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { request } = require('undici');
require('dotenv').config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// 1. Daftarkan Slash Command (/profile <username>)
const commands = [
    new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Mencari informasi profil akun Roblox')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Username Roblox yang ingin dicari')
                .setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
    console.log(`Bot ${client.user.tag} sudah aktif!`);

    // Mendaftarkan slash command secara global
    try {
        console.log('Memulai memperbarui slash commands (/)');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );
        console.log('Berhasil memuat ulang slash commands.');
    } catch (error) {
        console.error(error);
    }
});

// 2. Event Handler ketika command dijalankan
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'profile') {
        const username = interaction.options.getString('username');
        await interaction.deferReply(); // Menunda balasan karena proses fetch API

        try {
            // Langkah A: Cari User ID berdasarkan Username via Roblox API
            const userSearchRes = await request('https://users.roblox.com/v1/users/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword: username, limit: 1 })
            });
            const searchData = await userSearchRes.body.json();

            if (!searchData.data || searchData.data.length === 0) {
                return interaction.editReply(`❌ User Roblox dengan username **${username}** tidak ditemukan.`);
            }

            const userId = searchData.data[0].id;

            // Langkah B: Ambil Detail Informasi Lengkap User
            const userDetailRes = await request(`https://users.roblox.com/v1/users/${userId}`);
            const userData = await userDetailRes.body.json();

            // Langkah C: Ambil Gambar Avatar Thumbnail User
            const thumbRes = await request(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
            const thumbData = await thumbRes.body.json();
            const avatarUrl = thumbData.data[0] ? thumbData.data[0].imageUrl : null;

            // Format Tanggal Pembuatan Akun
            const createdDate = new Date(userData.created).toLocaleDateString('id-ID', {
                day: 'numeric', month: 'long', year: 'numeric'
            });

            // Langkah D: Buat Embed Discord yang Menarik
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(`Profil Roblox: ${userData.name}`)
                .setURL(`https://www.roblox.com/users/${userId}/profile`)
                .setThumbnail(avatarUrl)
                .addFields(
                    { name: 'Display Name', value: userData.displayName || '-', inline: true },
                    { name: 'User ID', value: String(userId), inline: true },
                    { name: 'Tanggal Dibuat', value: createdDate, inline: false },
                    { name: 'Status Banned', value: userData.isBanned ? 'Ya ❌' : 'Tidak (Aktif) ✅', inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'Roblox Profile Lookup Bot' });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await interaction.editReply('Terjadi kesalahan saat mengambil data dari server Roblox.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
