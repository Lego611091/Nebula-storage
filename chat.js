import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
const R = ["member", "friend", "link maker", "co owner", "owner"], MIN = { chat: 0, links: 2, ann: 3 }, OWNER = "lego61109";
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rnd = () => hex(crypto.getRandomValues(new Uint8Array(24)).buffer);
async function H(p, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(p), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(s), iterations: 100000 }, k, 256));
}
const pub = (r) => ({ n: r.name, role: r.role, xp: r.xp });
const byU = (ctx, u) => ctx.db.query("users").withIndex("by_u", (q) => q.eq("u", u)).unique();
async function who(ctx, token) {
  const s = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", token)).unique();
  return s ? await ctx.db.get(s.uid) : null;
}
async function start(ctx, uid) {
  const token = rnd();
  await ctx.db.insert("sessions", { token, uid });
  return { token, me: pub(await ctx.db.get(uid)) };
}
export const signup = mutation({ args: { u: v.string(), p: v.string() }, handler: async (ctx, a) => {
  const name = a.u.trim(), u = name.toLowerCase();
  if (!/^[a-z0-9_]{3,16}$/i.test(name)) throw new ConvexError("Username: 3-16 letters, numbers or _");
  if (a.p.length < 6) throw new ConvexError("Password needs 6+ characters");
  if (u === OWNER || (await byU(ctx, u))) throw new ConvexError("Username taken");
  const salt = rnd();
  return start(ctx, await ctx.db.insert("users", { u, name, salt, hash: await H(a.p, salt), role: "member", xp: 0, last: 0 }));
} });
export const login = mutation({ args: { u: v.string(), p: v.string() }, handler: async (ctx, a) => {
  const u = a.u.trim().toLowerCase();
  let r = await byU(ctx, u);
  if (!r && u === OWNER && process.env.OWNER_PASSWORD && a.p === process.env.OWNER_PASSWORD) {
    const salt = rnd();
    return start(ctx, await ctx.db.insert("users", { u, name: "Lego61109", salt, hash: await H(a.p, salt), role: "owner", xp: 0, last: 0 }));
  }
  if (!r || (await H(a.p, r.salt)) !== r.hash) throw new ConvexError("Wrong username or password");
  return start(ctx, r._id);
} });
export const me = query({ args: { token: v.string() }, handler: async (ctx, a) => { const m = await who(ctx, a.token); return m ? pub(m) : null; } });
export const list = query({ args: { token: v.string(), ch: v.string() }, handler: async (ctx, a) => {
  if (!(await who(ctx, a.token)) || !(a.ch in MIN)) return null;
  const rows = (await ctx.db.query("msgs").withIndex("by_ch", (q) => q.eq("ch", a.ch)).order("desc").take(a.ch === "ann" ? 500 : 200)).reverse(), cache = {}, out = [];
  for (const m of rows) { const u = cache[m.uid] || (cache[m.uid] = await ctx.db.get(m.uid)); if (u) out.push({ id: m._id, ch: m.ch, t: m.t, url: m.url, ts: m.ts, n: u.name, role: u.role, xp: u.xp }); }
  return out;
} });
export const send = mutation({ args: { token: v.string(), ch: v.string(), t: v.string(), url: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token);
  if (!m) throw new ConvexError("Please log in again");
  if (!(a.ch in MIN) || R.indexOf(m.role) < MIN[a.ch]) throw new ConvexError("You can't post here");
  const t = a.t.trim().slice(0, 500), url = a.url.trim().slice(0, 500);
  if (!t && !url) return;
  if (a.ch === "links" && !/^https?:\/\//i.test(url)) throw new ConvexError("Link must start with http(s)://");
  const n = Date.now();
  if (a.ch === "chat" && n - m.last > 8000) await ctx.db.patch(m._id, { xp: m.xp + 5, last: n });
  await ctx.db.insert("msgs", { ch: a.ch, uid: m._id, t, url: a.ch === "links" ? url : "", ts: n });
} });
export const del = mutation({ args: { token: v.string(), id: v.id("msgs") }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token);
  if (m && R.indexOf(m.role) >= 3) await ctx.db.delete(a.id);
} });
export const users = query({ args: { token: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token);
  if (!m || R.indexOf(m.role) < 3) return [];
  return (await ctx.db.query("users").collect()).map(pub).sort((x, y) => y.xp - x.xp);
} });
export const setRole = mutation({ args: { token: v.string(), n: v.string(), role: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token), ar = m ? R.indexOf(m.role) : -1, nr = R.indexOf(a.role);
  const t = await byU(ctx, a.n.toLowerCase());
  if (ar < 3 || !t || nr < 0 || nr > (ar === 4 ? 3 : 2) || R.indexOf(t.role) >= ar) throw new ConvexError("Not allowed");
  await ctx.db.patch(t._id, { role: R[nr] });
} });
