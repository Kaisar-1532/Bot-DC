// Klien Upstash Redis via REST (tanpa dependensi npm).

// Cari variabel dengan akhiran tertentu, apa pun prefix yang dipilih di Vercel
// (mis. STORAGE_KV_REST_API_URL). Token read-only diabaikan.
const find = (suffixes) => {
  for (const [k, v] of Object.entries(process.env)) {
    if (v && !k.includes("READ_ONLY") && suffixes.some((s) => k.endsWith(s))) return v;
  }
  return "";
};
const base = () =>
  (
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    find(["REST_API_URL", "REDIS_REST_URL"])
  ).replace(/\/$/, "");
const token = () =>
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  find(["REST_API_TOKEN", "REDIS_REST_TOKEN"]);

async function call(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `Redis HTTP ${res.status}`);
  return json;
}

export async function redis(command) {
  const json = await call(base(), command);
  if (json.error) throw new Error(json.error);
  return json.result;
}

export async function pipeline(commands) {
  const json = await call(`${base()}/pipeline`, commands);
  return json.map((x) => {
    if (x.error) throw new Error(x.error);
    return x.result;
  });
}

export async function getJSON(key) {
  const raw = await redis(["GET", key]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const setJSON = (key, value, exSeconds) =>
  redis(
    exSeconds
      ? ["SET", key, JSON.stringify(value), "EX", String(exSeconds)]
      : ["SET", key, JSON.stringify(value)]
  );
