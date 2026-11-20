import { randomBytes } from "node:crypto";
import { setJSON, getJSON } from "./redis.js";

export class UserError extends Error {}

const UA = "Mozilla/5.0 (compatible; DiscordBot/1.0)";
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? "—" : compact.format(Number(v)));
const cut = (s, max) => {
  const t = String(s ?? "").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
};
// Tombol link Discord maksimal 512 karakter; gambar embed boleh jauh lebih panjang.
const okLink = (s) => typeof s === "string" && /^https?:\/\//.test(s) && s.length <= 512;
const okImg = (s) => typeof s === "string" && /^https?:\/\//.test(s) && s.length <= 2000;

async function request(url, ms, headers = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      signal: ac.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}
const getJson = async (url, ms) => {
  const r = await request(url, ms);
  return r.ok ? r.data : null;
};

const LABELS = { tiktok: "TikTok", twitter: "X", youtube: "YouTube", facebook: "Facebook", instagram: "Instagram" };
const COLORS = { TikTok: 0x25f4ee, X: 0x1d9bf0, YouTube: 0xff0000, Facebook: 0x1877f2, Instagram: 0xe1306c };

// Kenali platform dari link. Link situs lain tetap diteruskan ke SaverAPI.
export function detect(raw) {
  let u;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  if (!host.includes(".") || /^[\d.]+$/.test(host)) return null;
  const is = (d) => host === d || host.endsWith("." + d);

  if (is("tiktok.com")) return { platform: "tiktok", url: u.toString() };

  if (["x.com", "twitter.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com"].some(is)) {
    const m = u.pathname.match(/^\/([^/]+)\/status(?:es)?\/(\d+)/);
    return m ? { platform: "twitter", url: `https://x.com/${m[1]}/status/${m[2]}`, user: m[1], id: m[2] } : null;
  }

  if (is("youtube.com") || host === "youtu.be") {
    let id = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (u.pathname === "/watch") id = u.searchParams.get("v");
    else id = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/)?.[1] ?? null;
    return id && /^[\w-]{11}$/.test(id)
      ? { platform: "youtube", url: `https://www.youtube.com/watch?v=${id}`, id }
      : null;
  }

  if (is("facebook.com") || is("fb.watch") || is("fb.com")) return { platform: "facebook", url: u.toString() };
  if (is("instagram.com")) return { platform: "instagram", url: u.toString() };
  return { platform: "other", url: u.toString() };
}

const mmss = (sec) => {
  const s = Math.round(Number(sec));
  if (!Number.isFinite(s) || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};
const isoSec = (iso) => {
  const m = String(iso || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : null;
};

// ---------- SaverAPI: mesin utama untuk semua link ----------
const toUrls = (v) =>
  (Array.isArray(v) ? v : v ? [v] : [])
    .map((x) => (typeof x === "string" ? x : x?.url || x?.download_url || null))
    .filter((x) => typeof x === "string" && /^https?:\/\//.test(x));

async function fetchSaver(url, ms) {
  const key = process.env.SAVERAPI_KEY;
  if (!key) throw new UserError("The download service isn't set up yet (SAVERAPI_KEY is missing on the server).");
  const r = await request(
    `https://saverapi.net/api/all-in-one-downloader-api?url=${encodeURIComponent(url)}`,
    ms,
    { "x-api-key": key }
  );
  if (r.status === 401 || r.status === 403) throw new UserError("The download service rejected the API key. Check SAVERAPI_KEY.");
  if (r.status === 402) throw new UserError("The download service refused the request (plan or quota). Check your SaverAPI account.");
  if (r.status === 429) throw new UserError("The download service is rate-limited right now. Try again in a moment.");
  const d = r.data;
  if (!r.ok || !d || d.error) return null;
  const urls = toUrls(d.download_url);
  if (!urls.length) return null;
  return {
    host: d.hosting || "",
    caption: d.caption || "",
    type: String(d.type || "video").toLowerCase(),
    thumb: d.thumb || null,
    urls,
    audio: toUrls(d.audio)[0] || null,
  };
}

// Link panjang (mis. fbcdn ~900 karakter) dibuat pendek lewat /api/dl agar muat di tombol.
async function linkFor(url, origin) {
  if (okLink(url)) return url;
  if (!origin) return null;
  const id = randomBytes(6).toString("hex");
  await setJSON(`dl:${id}`, { url }, 6 * 3600);
  return `${origin}/api/dl?k=${id}`;
}

// ---------- Pelengkap statistik (opsional, per platform) ----------
async function fetchTikTok(ref, ms) {
  const j = await getJson(`https://www.tikwm.com/api/?url=${encodeURIComponent(ref.url)}&hd=1`, ms);
  const d = j?.code === 0 ? j.data : null;
  if (!d) return null;
  const abs = (p) => (p ? (String(p).startsWith("http") ? p : `https://www.tikwm.com${String(p).startsWith("/") ? "" : "/"}${p}`) : null);
  const hd = abs(d.hdplay);
  const sd = abs(d.play);
  return {
    platform: "TikTok",
    title: "",
    description: d.title || "",
    author: d.author?.nickname || d.author?.unique_id || "",
    handle: d.author?.unique_id ? `@${d.author.unique_id}` : "",
    thumb: abs(d.cover) || abs(d.origin_cover),
    stats: { views: d.play_count, likes: d.digg_count, comments: d.comment_count, shares: d.share_count },
    duration: mmss(d.duration),
    downloads: [
      hd && { label: "⬇ Download HD", url: hd },
      sd && sd !== hd && { label: "⬇ Download", url: sd },
    ].filter(Boolean),
    note: !hd && !sd && Array.isArray(d.images) && d.images.length ? "This post is a photo slideshow, not a video." : "",
  };
}

async function fetchTwitter(ref, ms) {
  const j = await getJson(`https://api.fxtwitter.com/${ref.user}/status/${ref.id}`, ms);
  const t = j?.tweet;
  if (!t) return null;
  const vids = t.media?.videos?.length
    ? t.media.videos
    : (t.media?.all || []).filter((m) => m.type === "video" || m.type === "gif");
  const v = vids[0];
  return {
    platform: "X",
    title: "",
    description: t.text || "",
    author: t.author?.name || "",
    handle: t.author?.screen_name ? `@${t.author.screen_name}` : "",
    thumb: v?.thumbnail_url || t.media?.photos?.[0]?.url || t.author?.avatar_url || null,
    stats: { views: t.views, likes: t.likes, comments: t.replies, shares: t.retweets },
    duration: mmss(v?.duration),
    downloads: v?.url ? [{ label: "⬇ Download", url: v.url }] : [],
    note: v ? "" : "This post has no video.",
  };
}

async function fetchYouTube(ref, ms) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null; // tanpa key: tetap bisa download lewat SaverAPI, hanya tanpa statistik
  const j = await getJson(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${ref.id}&key=${key}`,
    ms
  );
  const it = j?.items?.[0];
  if (!it) return null;
  const th = it.snippet?.thumbnails || {};
  return {
    platform: "YouTube",
    title: it.snippet?.title || "",
    description: it.snippet?.description || "",
    author: it.snippet?.channelTitle || "",
    handle: "",
    thumb: (th.maxres || th.high || th.medium || th.default)?.url || null,
    stats: {
      views: it.statistics?.viewCount,
      likes: it.statistics?.likeCount,
      comments: it.statistics?.commentCount,
      shares: null,
    },
    duration: mmss(isoSec(it.contentDetails?.duration)),
    downloads: [],
    note: "",
  };
}

const ENRICHERS = { tiktok: fetchTikTok, twitter: fetchTwitter, youtube: fetchYouTube };
const canComment = (platform) => platform === "tiktok" || platform === "youtube";

function videoMessage(meta, ref, key) {
  const fields = [];
  const s = meta.stats;
  if (s) {
    if (s.views != null) fields.push({ name: "👁 Views", value: num(s.views), inline: true });
    if (s.likes != null) fields.push({ name: "❤️ Likes", value: num(s.likes), inline: true });
    if (s.comments != null) fields.push({ name: "💬 Comments", value: num(s.comments), inline: true });
    if (s.shares != null) fields.push({ name: "🔁 Shares", value: num(s.shares), inline: true });
  }
  if (meta.duration) fields.push({ name: "⏱ Duration", value: meta.duration, inline: true });

  const who = [meta.author, meta.handle].filter(Boolean).join(" · ");
  const embed = {
    author: who ? { name: cut(who, 256) } : undefined,
    title: cut(meta.title || `${meta.platform} post`, 256),
    url: ref.url,
    description: cut(meta.description, 1500) || undefined,
    color: meta.color,
    fields: fields.length ? fields : undefined,
    image: okImg(meta.thumb) ? { url: meta.thumb } : undefined,
    footer: { text: meta.note ? `${meta.platform} · ${meta.note}` : meta.platform },
  };

  const row = meta.downloads
    .filter((d) => okLink(d.url))
    .slice(0, 3)
    .map((d) => ({ type: 2, style: 5, label: d.label, url: d.url }));
  if (key) row.push({ type: 2, style: 2, label: "💬 Comments", custom_id: `vid:cm:${key}` });
  row.push({ type: 2, style: 5, label: "Open original", url: ref.url });
  return { embeds: [embed], components: [{ type: 1, components: row }] };
}

// ---------- Komentar ----------
async function fetchComments(ref, ms) {
  if (ref.platform === "tiktok") {
    const j = await getJson(`https://www.tikwm.com/api/comment/list/?url=${encodeURIComponent(ref.url)}&count=10`, ms);
    const list = j?.data?.comments;
    return Array.isArray(list)
      ? list.map((c) => ({ author: c.user?.nickname || c.user?.unique_id || "?", text: c.text, likes: c.digg_count }))
      : null;
  }
  if (ref.platform === "youtube") {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) throw new UserError("Reading YouTube comments needs a YOUTUBE_API_KEY on the server.");
    const j = await getJson(
      `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${ref.id}&order=relevance&maxResults=10&textFormat=plainText&key=${key}`,
      ms
    );
    return Array.isArray(j?.items)
      ? j.items.map((i) => {
          const s = i.snippet?.topLevelComment?.snippet || {};
          return { author: s.authorDisplayName || "?", text: s.textDisplay, likes: s.likeCount };
        })
      : null;
  }
  throw new UserError("Comments can't be read for this platform. Open the original post to read them.");
}

const BAD_LINK = "❌ That doesn't look like a valid link.";

// ---------- Pintu masuk ----------
export async function handleVideo(link, ms, origin) {
  const ref = detect(link);
  if (!ref) return { content: BAD_LINK };

  const enricher = ENRICHERS[ref.platform];
  const [saverRaw, enrich] = await Promise.all([
    fetchSaver(ref.url, ms).catch((e) => {
      if (e instanceof UserError) return e;
      console.error(e);
      return null;
    }),
    enricher
      ? enricher(ref, ms).catch((e) => {
          console.error(e);
          return null;
        })
      : null,
  ]);
  const saverErr = saverRaw instanceof UserError ? saverRaw : null;
  const saver = saverErr ? null : saverRaw;

  if (!saver && !enrich) {
    return {
      content: saverErr
        ? `❌ ${saverErr.message}`
        : "❌ Couldn't fetch that link. It may be private, removed or unsupported, or the service is busy. Try again in a moment.",
    };
  }

  // Tombol download: utamakan SaverAPI; kalau gagal, pakai pelengkap (TikTok / X).
  let downloads = [];
  if (saver) {
    const isImage = /image|photo|pic/.test(saver.type);
    const word = isImage ? "Image" : "Video";
    const max = saver.audio ? 2 : 3;
    const items = await Promise.all(
      saver.urls.slice(0, max).map(async (u, i) => ({
        label: saver.urls.length === 1 ? `⬇ Download${isImage ? " image" : ""}` : `⬇ ${word} ${i + 1}`,
        url: await linkFor(u, origin),
      }))
    );
    downloads = items.filter((d) => d.url);
    if (saver.audio) {
      const a = await linkFor(saver.audio, origin);
      if (a) downloads.push({ label: "🎵 Audio", url: a });
    }
  } else if (enrich?.downloads?.length) {
    downloads = enrich.downloads;
  }

  const platform = enrich?.platform || LABELS[ref.platform] || (saver?.host ? saver.host[0].toUpperCase() + saver.host.slice(1) : "Link");
  const meta = {
    platform,
    color: COLORS[platform] ?? 0x5865f2,
    title: enrich?.title || "",
    description: enrich?.description || saver?.caption || "",
    author: enrich?.author || "",
    handle: enrich?.handle || "",
    thumb: enrich?.thumb || saver?.thumb || null,
    stats: enrich?.stats || null,
    duration: enrich?.duration || null,
    downloads,
    note: downloads.length ? "" : enrich?.note || saverErr?.message || "No download link is available right now.",
  };

  let key = null;
  if (canComment(ref.platform)) {
    key = randomBytes(5).toString("hex");
    await setJSON(`vid:${key}`, ref, 3600);
  }
  return videoMessage(meta, ref, key);
}

export async function handleComments(key, ms) {
  const ref = /^[a-f0-9]{10}$/.test(key) ? await getJSON(`vid:${key}`) : null;
  if (!ref) return { content: "This button expired. Run /video again to get fresh buttons." };
  let list;
  try {
    list = await fetchComments(ref, ms);
  } catch (e) {
    if (e instanceof UserError) return { content: `ℹ️ ${e.message}` };
    throw e;
  }
  if (!list) return { content: "❌ Couldn't load comments. They may be turned off, or the service is busy." };
  if (!list.length) return { content: "No comments yet." };

  let body = "";
  for (const c of list) {
    const line = `**${cut(c.author, 40)}**${c.likes ? ` (👍 ${num(c.likes)})` : ""}\n${cut(String(c.text ?? "").replace(/\s+/g, " "), 300)}\n\n`;
    if ((body + line).length > 3900) break;
    body += line;
  }
  return {
    embeds: [{ title: "💬 Top comments", description: body.trim() || "—", color: 0x5865f2, url: ref.url, footer: { text: "Top 10 · sorted by relevance" } }],
  };
}