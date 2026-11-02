import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  users: defineTable({ u: v.string(), name: v.string(), salt: v.string(), hash: v.string(), role: v.string(), xp: v.number(), last: v.number(), bio: v.optional(v.string()), avatar: v.optional(v.string()), ban: v.optional(v.string()) }).index("by_u", ["u"]),
  sessions: defineTable({ token: v.string(), uid: v.id("users") }).index("by_token", ["token"]),
  msgs: defineTable({ ch: v.string(), uid: v.id("users"), t: v.string(), url: v.string(), ts: v.number(), reply: v.optional(v.string()), pin: v.optional(v.boolean()), rx: v.optional(v.any()), to: v.optional(v.string()) }).index("by_ch", ["ch"]),
  presence: defineTable({ uid: v.id("users"), seen: v.number() }).index("by_uid", ["uid"]),
  rc: defineTable({ code: v.string(), host: v.id("users"), viewer: v.optional(v.id("users")), state: v.string(), offer: v.optional(v.string()), answer: v.optional(v.string()), hi: v.array(v.string()), vi: v.array(v.string()) }).index("by_code", ["code"]),
});
