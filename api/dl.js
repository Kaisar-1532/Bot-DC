import { getJSON } from "../lib/redis.js";

// Link pendek untuk tombol download: /api/dl?k=<id> -> arahkan ke URL video asli.
export async function GET(request) {
  const k = new URL(request.url).searchParams.get("k") || "";
  const rec = /^[a-f0-9]{12}$/.test(k) ? await getJSON(`dl:${k}`) : null;
  if (!rec?.url || !/^https?:\/\//.test(rec.url)) {
    return new Response("This download link has expired. Run /video again.", { status: 404 });
  }
  return new Response(null, {
    status: 302,
    headers: { Location: rec.url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}