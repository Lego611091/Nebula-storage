import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  users: defineTable({ u: v.string(), name: v.string(), salt: v.string(), hash: v.string(), role: v.string(), xp: v.number(), last: v.number() }).index("by_u", ["u"]),
  sessions: defineTable({ token: v.string(), uid: v.id("users") }).index("by_token", ["token"]),
  msgs: defineTable({ ch: v.string(), uid: v.id("users"), t: v.string(), url: v.string(), ts: v.number() }).index("by_ch", ["ch"]),
});
