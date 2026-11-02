import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
const R = ["member", "friend", "link maker", "co owner", "owner"], MIN = { chat: 0, dm: 1, links: 2, ann: 3 }, OWNER = "lego61109";
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rnd = () => hex(crypto.getRandomValues(new Uint8Array(24)).buffer);
async function H(p, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(p), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(s), iterations: 100000 }, k, 256));
}
const pub = (r) => ({ n: r.name, role: r.role, xp: r.xp, avatar: r.avatar || '', bio: r.bio || '', ban: r.ban || '' });
const byU = (ctx, u) => ctx.db.query("users").withIndex("by_u", (q) => q.eq("u", u)).unique();
async function who(ctx, token) {
  const s = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", token)).unique();
  const u = s ? await ctx.db.get(s.uid) : null;
  return u && u.ban !== "ban" ? u : null;
}
async function start(ctx, uid) {
  const token = rnd();
  await ctx.db.insert("sessions", { token, uid });
  return { token, me: pub(await ctx.db.get(uid)) };
}
export const signup = mutation({ args: { u: v.string(), p: v.string(), agree: v.boolean() }, handler: async (ctx, a) => {
  const name = a.u.trim(), u = name.toLowerCase();
  if (!/^[a-z0-9_]{3,16}$/i.test(name)) throw new ConvexError("Username: 3-16 letters, numbers or _");
  if (a.p.length < 6) throw new ConvexError("Password needs 6+ characters");
  if (!a.agree) throw new ConvexError("You must agree to the rules");
  if (u === OWNER || (await byU(ctx, u))) throw new ConvexError("Username taken");
  const salt = rnd();
  return start(ctx, await ctx.db.insert("users", { u, name, salt, hash: await H(a.p, salt), role: "member", xp: 0, last: 0 }));
} });
export const login = mutation({ args: { u: v.string(), p: v.string(), agree: v.optional(v.boolean()) }, handler: async (ctx, a) => {
  const u = a.u.trim().toLowerCase();
  let r = await byU(ctx, u);
  if (!r && u === OWNER && process.env.OWNER_PASSWORD && a.p === process.env.OWNER_PASSWORD) {
    const salt = rnd();
    return start(ctx, await ctx.db.insert("users", { u, name: "Lego61109", salt, hash: await H(a.p, salt), role: "owner", xp: 0, last: 0 }));
  }
  if (!r || (await H(a.p, r.salt)) !== r.hash) throw new ConvexError("Wrong username or password");
  if (r.ban === "ban") throw new ConvexError("You are banned");
  return start(ctx, r._id);
} });
export const me = query({ args: { token: v.string() }, handler: async (ctx, a) => { const m = await who(ctx, a.token); return m ? pub(m) : null; } });
export const list = query({ args: { token: v.string(), ch: v.string() }, handler: async (ctx, a) => {
  const me = await who(ctx, a.token);
  if (!me || !(a.ch in MIN)) return null;
  const rows = (await ctx.db.query("msgs").withIndex("by_ch", (q) => q.eq("ch", a.ch)).order("desc").take(a.ch === "ann" ? 500 : 200)).reverse(), cache = {}, out = [];
  for (const m of rows) { if (a.ch === "dm" && m.uid !== me._id && m.to !== me.u) continue; const u = cache[m.uid] || (cache[m.uid] = await ctx.db.get(m.uid)); if (u) out.push({ id: m._id, ch: m.ch, t: m.t, url: m.url, ts: m.ts, n: u.name, role: u.role, xp: u.xp, avatar: u.avatar || '', reply: m.reply || '', pin: !!m.pin, rx: m.rx || {}, to: m.to || '' }); }
  return out;
} });
export const send = mutation({ args: { token: v.string(), ch: v.string(), t: v.string(), url: v.string(), reply: v.optional(v.string()), to: v.optional(v.string()) }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token);
  if (!m) throw new ConvexError("Please log in again");
  if (m.ban === "mute") throw new ConvexError("You are muted");
  if (!(a.ch in MIN) || R.indexOf(m.role) < MIN[a.ch]) throw new ConvexError("You can't post here");
  const t = a.t.trim().slice(0, 500), url = a.url.trim().slice(0, 500);
  if (!t && !url) return;
  if (a.ch === "links" && !/^https?:\/\//i.test(url)) throw new ConvexError("Link must start with http(s)://");
  const n = Date.now();
  if (a.ch === "chat" && n - m.last > 8000) await ctx.db.patch(m._id, { xp: m.xp + 5, last: n });
  const doc = { ch: a.ch, uid: m._id, t, url: a.ch === "links" ? url : "", ts: n, reply: (a.reply || "").slice(0, 100) };
  if (a.ch === "dm") { const tg = await byU(ctx, (a.to || "").trim().toLowerCase()); if (!tg) throw new ConvexError("No user with that name"); doc.to = tg.u; }
  await ctx.db.insert("msgs", doc);
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
export const react = mutation({ args: { token: v.string(), id: v.id("msgs"), idx: v.number() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token), g = await ctx.db.get(a.id);
  if (!m || !g || !(a.idx >= 0 && a.idx < 4)) return;
  const rx = { ...(g.rx || {}) }, k = String(a.idx), l = rx[k] || [];
  rx[k] = l.includes(m.name) ? l.filter((x) => x !== m.name) : [...l, m.name];
  await ctx.db.patch(a.id, { rx });
} });
export const pin = mutation({ args: { token: v.string(), id: v.id("msgs") }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token), g = await ctx.db.get(a.id);
  if (m && g && g.ch === "ann" && R.indexOf(m.role) >= 3) await ctx.db.patch(a.id, { pin: !g.pin });
} });
export const setBan = mutation({ args: { token: v.string(), n: v.string(), mode: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token), t = await byU(ctx, a.n.toLowerCase());
  if (!m || !t || R.indexOf(m.role) < 3 || R.indexOf(t.role) >= R.indexOf(m.role) || !["none", "mute", "ban"].includes(a.mode)) throw new ConvexError("Not allowed");
  await ctx.db.patch(t._id, { ban: a.mode === "none" ? "" : a.mode });
} });
export const setProfile = mutation({ args: { token: v.string(), bio: v.string(), avatar: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token);
  if (!m) throw new ConvexError("Please log in again");
  const avatar = a.avatar.trim().slice(0, 400);
  if (avatar && !/^https:\/\//i.test(avatar)) throw new ConvexError("Picture must be an https:// link");
  await ctx.db.patch(m._id, { bio: a.bio.trim().slice(0, 120), avatar });
} });
export const ping = mutation({ args: { token: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token);
  if (!m) return;
  const p = await ctx.db.query("presence").withIndex("by_uid", (q) => q.eq("uid", m._id)).unique();
  if (p) await ctx.db.patch(p._id, { seen: Date.now() }); else await ctx.db.insert("presence", { uid: m._id, seen: Date.now() });
} });
export const online = query({ args: { token: v.string() }, handler: async (ctx, a) => {
  if (!(await who(ctx, a.token))) return [];
  const out = [];
  for (const p of await ctx.db.query("presence").collect()) if (p.seen > Date.now() - 70000) { const u = await ctx.db.get(p.uid); if (u) out.push(u.name); }
  return out;
} });
export const top = query({ args: { token: v.string() }, handler: async (ctx, a) => {
  if (!(await who(ctx, a.token))) return [];
  return (await ctx.db.query("users").collect()).sort((x, y) => y.xp - x.xp).slice(0, 10).map(pub);
} });
const rcGet = (ctx, code) => ctx.db.query("rc").withIndex("by_code", (q) => q.eq("code", code.trim())).unique();
export const rcHost = mutation({ args: { token: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token);
  if (!m) throw new ConvexError("Please log in again");
  for (const o of await ctx.db.query("rc").collect()) if (o.host === m._id) await ctx.db.delete(o._id);
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  await ctx.db.insert("rc", { code, host: m._id, state: "waiting", hi: [], vi: [] });
  return code;
} });
export const rcJoin = mutation({ args: { token: v.string(), code: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token), r = await rcGet(ctx, a.code);
  if (!m) throw new ConvexError("Please log in again");
  if (!r || r.state !== "waiting" || r.host === m._id) throw new ConvexError("Invalid or busy code");
  await ctx.db.patch(r._id, { viewer: m._id, state: "requested" });
} });
export const rcState = query({ args: { token: v.string(), code: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token), r = await rcGet(ctx, a.code);
  if (!m || !r) return null;
  const hostSide = r.host === m._id;
  if (!hostSide && r.viewer !== m._id) return null;
  const vw = r.viewer ? await ctx.db.get(r.viewer) : null;
  return { state: r.state, host: hostSide, viewer: vw ? vw.name : "", offer: r.offer || "", answer: r.answer || "", hi: r.hi, vi: r.vi };
} });
export const rcSet = mutation({ args: { token: v.string(), code: v.string(), state: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token), r = await rcGet(ctx, a.code);
  if (!m || !r) return;
  const host = r.host === m._id;
  if ((host && ["allowed", "control", "denied", "ended"].includes(a.state)) || (r.viewer === m._id && a.state === "ended")) await ctx.db.patch(r._id, { state: a.state });
} });
export const rcSig = mutation({ args: { token: v.string(), code: v.string(), kind: v.string(), data: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token), r = await rcGet(ctx, a.code);
  if (!m || !r || a.data.length > 20000) return;
  if (r.host === m._id) { if (a.kind === "offer") await ctx.db.patch(r._id, { offer: a.data }); else if (a.kind === "hi") await ctx.db.patch(r._id, { hi: [...r.hi, a.data] }); }
  else if (r.viewer === m._id) { if (a.kind === "answer") await ctx.db.patch(r._id, { answer: a.data }); else if (a.kind === "vi") await ctx.db.patch(r._id, { vi: [...r.vi, a.data] }); }
} });
