import { randomBytes } from "node:crypto";
import { redis, getJSON, setJSON } from "./redis.js";

export const SESSION_TTL = 3 * 24 * 3600;

export function readCookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export const cookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export async function createSession(data) {
  const sid = randomBytes(24).toString("hex");
  await setJSON(`sess:${sid}`, data, SESSION_TTL);
  return sid;
}

export async function getSession(request) {
  const sid = readCookie(request, "sid");
  if (!sid || !/^[a-f0-9]{48}$/.test(sid)) return null;
  return getJSON(`sess:${sid}`);
}

export async function destroySession(request) {
  const sid = readCookie(request, "sid");
  if (sid && /^[a-f0-9]{48}$/.test(sid)) await redis(["DEL", `sess:${sid}`]);
}
