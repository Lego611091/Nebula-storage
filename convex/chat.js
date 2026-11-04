import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
const R = ["member", "friend", "link maker", "admin", "co owner", "owner"], MIN = { chat: 0, dm: 1, links: 2, ann: 3 }, OWNER = "lego61109";
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rnd = () => hex(crypto.getRandomValues(new Uint8Array(24)).buffer);
async function H(p, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(p), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(s), iterations: 100000 }, k, 256));
}
const pub = (r) => ({ n: r.name, role: r.role, xp: r.xp, avatar: r.avatar || '', bio: r.bio || '', ban: r.ban || '', tokens: r.tokens || 0, ac: r.ac || 0, tag: r.tag || '' });
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
  const ci = await chInfo(ctx, a.ch);
  if (!me || !ci) return null;
  const rows = (await ctx.db.query("msgs").withIndex("by_ch", (q) => q.eq("ch", a.ch)).order("desc").take(a.ch === "ann" ? 500 : 200)).reverse(), cache = {}, out = [];
  for (const m of rows) { if (a.ch === "dm" && m.uid !== me._id && m.to !== me.u) continue; const u = cache[m.uid] || (cache[m.uid] = await ctx.db.get(m.uid)); if (u) out.push({ id: m._id, ch: m.ch, t: m.t, url: m.url, ts: m.ts, n: u.name, role: u.role, xp: u.xp, avatar: u.avatar || '', reply: m.reply || '', pin: !!m.pin, rx: m.rx || {}, to: m.to || '', tag: u.tag || '' }); }
  return out;
} });
export const send = mutation({ args: { token: v.string(), ch: v.string(), t: v.string(), url: v.string(), reply: v.optional(v.string()), to: v.optional(v.string()) }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token);
  if (!m) throw new ConvexError("Please log in again");
  if (m.ban === "mute") throw new ConvexError("You are muted");
  if (m.until && m.until > Date.now()) throw new ConvexError("You are timed out");
  if (/@everyone/i.test(a.t) && R.indexOf(m.role) < 3) throw new ConvexError("Only staff can use @everyone");
  const ci = await chInfo(ctx, a.ch);
  if (!ci || R.indexOf(m.role) < ci.min) throw new ConvexError("You can't post here");
  const t = a.t.trim().slice(0, 500), url = a.url.trim().slice(0, 500);
  if (!t && !url) return;
  if (a.ch === "links" && !/^https?:\/\//i.test(url)) throw new ConvexError("Link must start with http(s)://");
  const n = Date.now();
  if (a.ch === "chat" && n - m.last > 8000) await ctx.db.patch(m._id, { xp: m.xp + 5, last: n });
  const doc = { ch: a.ch, uid: m._id, t, url: a.ch === "links" ? url : "", ts: n, reply: (a.reply || "").slice(0, 100) };
  if (a.ch === "dm") { const tg = await byU(ctx, (a.to || "").trim().toLowerCase()); if (!tg) throw new ConvexError("No user with that name"); doc.to = tg.u; }
  await ctx.db.insert("msgs", doc);
  if (a.ch === "chat") await bump(ctx, m._id, "msg");
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
  if (ar < 4 || !t || nr < 0 || nr > (ar === 5 ? 4 : 3) || R.indexOf(t.role) >= ar) throw new ConvexError("Not allowed");
  await ctx.db.patch(t._id, { role: R[nr] });
} });
export const react = mutation({ args: { token: v.string(), id: v.id("msgs"), idx: v.number() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token), g = await ctx.db.get(a.id);
  if (!m || !g || !(a.idx >= 0 && a.idx < 4)) return;
  const rx = { ...(g.rx || {}) }, k = String(a.idx), l = rx[k] || [];
  rx[k] = l.includes(m.name) ? l.filter((x) => x !== m.name) : [...l, m.name];
  await ctx.db.patch(a.id, { rx });
  await bump(ctx, m._id, "rx");
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
const isMod = (m) => R.indexOf(m.role) >= 3;
export const timeout = mutation({ args: { token: v.string(), n: v.string(), mins: v.number() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token), t = await byU(ctx, a.n.toLowerCase());
  if (!m || !t || !isMod(m) || R.indexOf(t.role) >= R.indexOf(m.role)) throw new ConvexError("Not allowed");
  await ctx.db.patch(t._id, { until: a.mins > 0 ? Date.now() + Math.min(a.mins, 10080) * 60000 : 0 });
} });
export const xpSet = mutation({ args: { token: v.string(), n: v.string(), amount: v.number() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token), t = await byU(ctx, a.n.toLowerCase());
  if (!m || !t || R.indexOf(m.role) < 4) throw new ConvexError("Not allowed");
  await ctx.db.patch(t._id, { xp: Math.max(0, Math.round(t.xp + a.amount)) });
} });
const tkGet = async (ctx, token, seq) => {
  const m = await who(ctx, token);
  if (!m) return {};
  const t = await ctx.db.query("tickets").withIndex("by_seq", (q) => q.eq("seq", seq)).unique();
  return t && (t.uid === m._id || isMod(m)) ? { m, t } : {};
};
export const tkOpen = mutation({ args: { token: v.string(), kind: v.string(), text: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token);
  if (!m) throw new ConvexError("Please log in again");
  if (!["support", "staff"].includes(a.kind) || !a.text.trim()) throw new ConvexError("Invalid ticket");
  const all = await ctx.db.query("tickets").collect();
  if (all.some((t) => t.uid === m._id && t.kind === a.kind && t.status === "open")) throw new ConvexError("You already have an open " + a.kind + " ticket");
  const seq = 1 + all.reduce((x, t) => Math.max(x, t.seq), 0);
  await ctx.db.insert("tickets", { seq, kind: a.kind, uid: m._id, status: "open" });
  await ctx.db.insert("msgs", { ch: "tk" + seq, uid: m._id, t: a.text.trim().slice(0, 1500), url: "", ts: Date.now() });
  return seq;
} });
export const tickets = query({ args: { token: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token);
  if (!m) return [];
  const all = await ctx.db.query("tickets").collect(), out = [];
  for (const kind of ["support", "staff"]) {
    const open = all.filter((t) => t.kind === kind && t.status === "open").sort((x, y) => x.seq - y.seq);
    for (let i = 0; i < open.length; i++) if (open[i].uid === m._id || isMod(m)) { const u = await ctx.db.get(open[i].uid); out.push({ seq: open[i].seq, name: kind + "-" + (i + 1), who: u ? u.name : "" }); }
  }
  return out.sort((x, y) => x.seq - y.seq);
} });
export const tkList = query({ args: { token: v.string(), seq: v.number() }, handler: async (ctx, a) => {
  const { t } = await tkGet(ctx, a.token, a.seq);
  if (!t) return null;
  const out = [];
  for (const g of await ctx.db.query("msgs").withIndex("by_ch", (q) => q.eq("ch", "tk" + a.seq)).take(300)) { const u = await ctx.db.get(g.uid); if (u) out.push({ id: g._id, t: g.t, ts: g.ts, n: u.name, role: u.role }); }
  return out;
} });
export const tkSend = mutation({ args: { token: v.string(), seq: v.number(), t: v.string() }, handler: async (ctx, a) => {
  const { m, t } = await tkGet(ctx, a.token, a.seq);
  if (!t || t.status !== "open" || !a.t.trim()) throw new ConvexError("Ticket not available");
  if (m.ban === "mute" || (m.until && m.until > Date.now())) throw new ConvexError("You are muted");
  await ctx.db.insert("msgs", { ch: "tk" + a.seq, uid: m._id, t: a.t.trim().slice(0, 1500), url: "", ts: Date.now() });
} });
export const tkClose = mutation({ args: { token: v.string(), seq: v.number() }, handler: async (ctx, a) => {
  const { t } = await tkGet(ctx, a.token, a.seq);
  if (t) await ctx.db.patch(t._id, { status: "closed" });
} });
const DAY = () => new Date().toISOString().slice(0, 10);
const QUESTS = [{ id: "msg", name: "Send 10 chat messages", need: 10, reward: 20 }, { id: "rx", name: "React to 3 messages", need: 3, reward: 15 }, { id: "clk", name: "Click 25 times", need: 25, reward: 10 }];
const qOf = (u) => (u.qd && u.qd.day === DAY() ? { ...u.qd } : { day: DAY(), msg: 0, rx: 0, clk: 0, got: [] });
async function bump(ctx, uid, k) { const u = await ctx.db.get(uid), q = qOf(u); q[k] = (q[k] || 0) + 1; await ctx.db.patch(uid, { qd: q }); }
async function chInfo(ctx, ch) {
  if (ch in MIN) return { min: MIN[ch] };
  if (!ch.startsWith("c_")) return null;
  const c = await ctx.db.query("channels").withIndex("by_key", (q) => q.eq("key", ch.slice(2))).unique();
  return c ? { min: c.min } : null;
}
const need = async (ctx, token, rank) => { const m = await who(ctx, token); if (!m || R.indexOf(m.role) < rank) throw new ConvexError("Not allowed"); return m; };
export const click = mutation({ args: { token: v.string() }, handler: async (ctx, a) => {
  const m = await need(ctx, a.token, 0), q = qOf(m);
  if (q.clk >= 200) throw new ConvexError("Daily click limit reached");
  q.clk++;
  await ctx.db.patch(m._id, { tokens: (m.tokens || 0) + 1, qd: q });
} });
export const claim = mutation({ args: { token: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token);
  if (!m || !m.ac) return 0;
  const mins = Math.min(480, Math.floor((Date.now() - (m.acAt || Date.now())) / 60000));
  if (mins < 1) return 0;
  await ctx.db.patch(m._id, { tokens: (m.tokens || 0) + mins * m.ac, acAt: (m.acAt || Date.now()) + mins * 60000 });
  return mins * m.ac;
} });
export const buy = mutation({ args: { token: v.string(), item: v.string() }, handler: async (ctx, a) => {
  const m = await need(ctx, a.token, 0), t = m.tokens || 0;
  if (a.item === "ac") {
    const lv = m.ac || 0, price = 100 * (lv + 1);
    if (lv >= 5) throw new ConvexError("Already max level");
    if (t < price) throw new ConvexError("Not enough tokens");
    await ctx.db.patch(m._id, { tokens: t - price, ac: lv + 1, acAt: Date.now() });
  } else if (a.item === "xp") {
    if (t < 50) throw new ConvexError("Not enough tokens");
    await ctx.db.patch(m._id, { tokens: t - 50, xp: m.xp + 100 });
  } else throw new ConvexError("Unknown item");
} });
export const quests = query({ args: { token: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token);
  if (!m) return [];
  const q = qOf(m);
  return QUESTS.map((x) => ({ ...x, have: q[x.id] || 0, got: q.got.includes(x.id) }));
} });
export const claimQuest = mutation({ args: { token: v.string(), id: v.string() }, handler: async (ctx, a) => {
  const m = await need(ctx, a.token, 0), q = qOf(m), x = QUESTS.find((z) => z.id === a.id);
  if (!x || (q[x.id] || 0) < x.need || q.got.includes(x.id)) throw new ConvexError("Quest not ready");
  q.got = [...q.got, x.id];
  await ctx.db.patch(m._id, { tokens: (m.tokens || 0) + x.reward, qd: q });
} });
export const channels = query({ args: { token: v.string() }, handler: async (ctx, a) => {
  const m = await who(ctx, a.token);
  if (!m) return [];
  return (await ctx.db.query("channels").collect()).filter((c) => c.min <= R.indexOf(m.role)).map((c) => ({ key: c.key, name: c.name, min: c.min }));
} });
export const chAdd = mutation({ args: { token: v.string(), name: v.string(), min: v.number() }, handler: async (ctx, a) => {
  const m = await need(ctx, a.token, 4), name = a.name.trim().slice(0, 20);
  if (!name || !(a.min >= 0 && a.min <= R.indexOf(m.role))) throw new ConvexError("Invalid channel");
  await ctx.db.insert("channels", { key: rnd().slice(0, 8), name, min: Math.floor(a.min) });
} });
export const chDel = mutation({ args: { token: v.string(), key: v.string() }, handler: async (ctx, a) => {
  await need(ctx, a.token, 4);
  const c = await ctx.db.query("channels").withIndex("by_key", (q) => q.eq("key", a.key)).unique();
  if (!c) return;
  for (const g of await ctx.db.query("msgs").withIndex("by_ch", (q) => q.eq("ch", "c_" + a.key)).take(1000)) await ctx.db.delete(g._id);
  await ctx.db.delete(c._id);
} });
export const clearChat = mutation({ args: { token: v.string(), ch: v.string() }, handler: async (ctx, a) => {
  await need(ctx, a.token, 4);
  if (a.ch === "dm" || !(await chInfo(ctx, a.ch))) throw new ConvexError("Invalid channel");
  for (const g of await ctx.db.query("msgs").withIndex("by_ch", (q) => q.eq("ch", a.ch)).take(2000)) await ctx.db.delete(g._id);
} });
export const roles = query({ args: { token: v.string() }, handler: async (ctx, a) => (await who(ctx, a.token)) ? (await ctx.db.query("roles").collect()).map((r) => ({ name: r.name, color: r.color })) : [] });
export const roleAdd = mutation({ args: { token: v.string(), name: v.string(), color: v.string() }, handler: async (ctx, a) => {
  await need(ctx, a.token, 4);
  const name = a.name.trim().slice(0, 16);
  if (!name || !/^#[0-9a-f]{6}$/i.test(a.color.trim())) throw new ConvexError("Use a name and a color like #ff8800");
  if ((await ctx.db.query("roles").collect()).some((r) => r.name.toLowerCase() === name.toLowerCase())) throw new ConvexError("Role already exists");
  await ctx.db.insert("roles", { name, color: a.color.trim() });
} });
export const roleDel = mutation({ args: { token: v.string(), name: v.string() }, handler: async (ctx, a) => {
  await need(ctx, a.token, 4);
  for (const r of await ctx.db.query("roles").collect()) if (r.name === a.name) await ctx.db.delete(r._id);
  for (const u of await ctx.db.query("users").collect()) if (u.tag === a.name) await ctx.db.patch(u._id, { tag: "" });
} });
export const setTag = mutation({ args: { token: v.string(), n: v.string(), tag: v.string() }, handler: async (ctx, a) => {
  const m = await need(ctx, a.token, 4), t = await byU(ctx, a.n.toLowerCase());
  if (!t || R.indexOf(t.role) >= R.indexOf(m.role) && t._id !== m._id) throw new ConvexError("Not allowed");
  if (a.tag && !(await ctx.db.query("roles").collect()).some((r) => r.name === a.tag)) throw new ConvexError("No such role");
  await ctx.db.patch(t._id, { tag: a.tag });
} });
export const setting = query({ args: { token: v.string(), key: v.string() }, handler: async (ctx, a) => {
  if (!(await who(ctx, a.token))) return "";
  const s = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", a.key)).unique();
  return s ? s.value : "";
} });
export const setSetting = mutation({ args: { token: v.string(), key: v.string(), value: v.string() }, handler: async (ctx, a) => {
  await need(ctx, a.token, 4);
  if (a.key !== "update") throw new ConvexError("Unknown setting");
  const s = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", a.key)).unique(), value = a.value.slice(0, 2000);
  if (s) await ctx.db.patch(s._id, { value }); else await ctx.db.insert("settings", { key: a.key, value });
} });
