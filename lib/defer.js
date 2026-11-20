const API = "https://discord.com/api/v10";

// Konteks request Vercel (dipakai untuk waitUntil). Null kalau tidak tersedia.
const vercelContext = () => globalThis[Symbol.for("@vercel/request-context")]?.get?.() ?? null;

async function editOriginal(interaction, message) {
  const { flags, ...data } = message;
  await fetch(`${API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...data }),
  });
}

// Discord hanya memberi 3 detik. Kalau Vercel mengizinkan kerja di belakang layar,
// balas "sedang berpikir" dulu lalu edit pesannya setelah selesai. Kalau tidak,
// kerjakan langsung dengan batas waktu ketat.
export async function respondDeferred(interaction, work, ephemeral) {
  const ctx = vercelContext();
  if (ctx?.waitUntil) {
    ctx.waitUntil(
      (async () => {
        let msg;
        try {
          msg = await work(8000);
        } catch (e) {
          console.error(e);
          msg = { content: "❌ Something went wrong. Please try again." };
        }
        await editOriginal(interaction, msg);
      })()
    );
    return Response.json({ type: 5, data: ephemeral ? { flags: 64 } : {} });
  }

  const timeout = new Promise((r) =>
    setTimeout(() => r({ content: "⏱️ That took too long. Please try again." }), 2400)
  );
  let msg;
  try {
    msg = await Promise.race([work(2200), timeout]);
  } catch (e) {
    console.error(e);
    msg = { content: "❌ Something went wrong. Please try again." };
  }
  return Response.json({
    type: 4,
    data: { ...msg, flags: ephemeral ? 64 : msg.flags, allowed_mentions: { parse: [] } },
  });
}