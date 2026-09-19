import fs from "node:fs";
import path from "node:path";
import { extractRequiredFields, patchCoverage } from "../extensions/card-compat/logic.js";
function readCard(file) {
  const buf = fs.readFileSync(file); let off = 8; const found = {};
  while (off + 8 <= buf.length) { const len = buf.readUInt32BE(off), type = buf.toString("latin1", off + 4, off + 8); const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "tEXt" || type === "iTXt") { const z = data.indexOf(0), kw = data.subarray(0, z).toString("latin1");
      if (kw === "chara" || kw === "ccv3") { let payload; if (type === "tEXt") payload = Buffer.from(data.subarray(z + 1).toString("latin1"), "base64").toString("utf8"); else { const pa = data.subarray(z + 1); const p1 = pa.indexOf(0), p2 = pa.indexOf(0, p1 + 1), p3 = pa.indexOf(0, p2 + 1), p4 = pa.indexOf(0, p3 + 1); payload = pa.subarray(p4 + 1).toString("utf8"); } found[kw] = payload; } } off += 12 + len; }
  return JSON.parse(found.chara || found.ccv3);
}
const CHARS = "D:/AI/SillyTavern/Data/default-user/characters";
const name = "破产后姐姐和美母和我的性交易";
const f = fs.readdirSync(CHARS).find(c => c.startsWith(name));
const entries = readCard(path.join(CHARS, f)).data.character_book.entries;
const req = extractRequiredFields(entries, 12);
console.log("真实卡能抽出的必更字段（" + req.length + " 条）：");
for (const r of req) console.log("   " + r.path + "  ← " + r.check.slice(0, 70));
// 用你最新那条消息验证覆盖度
const CHATS = "D:/AI/SillyTavern/Data/default-user/chats";
const folder = path.join(CHATS, fs.readdirSync(CHATS).find(d => d.startsWith("破产后姐姐")));
const file = fs.readdirSync(folder).filter(x => x.endsWith(".jsonl")).map(x => ({ x, m: fs.statSync(path.join(folder, x)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
const msgs = []; for (const l of fs.readFileSync(path.join(folder, file.x), "utf8").split(/\r?\n/).filter(t => t.trim())) { try { msgs.push(JSON.parse(l)); } catch (_) {} }
const last = String(msgs.filter(x => x && !x.is_user).pop()?.mes || "");
const cov = patchCoverage(last, req);
console.log("");
console.log("你最新一轮 patch 覆盖： " + cov.covered.length + "/" + cov.total);
console.log("   覆盖: " + cov.covered.join("、"));
console.log("   缺失: " + (cov.missing.join("、") || "无"));