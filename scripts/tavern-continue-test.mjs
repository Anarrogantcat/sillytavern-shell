import fs from "node:fs";
import path from "node:path";
const SRC = fs.readFileSync("tavern-scripts/continue-button-all-cards.js", "utf8");
// 用沙箱跑脚本（document=undefined → 不初始化 UI，只取导出的纯函数）
const box = { window: {}, localStorage: { getItem: () => null, setItem: () => {} } };
new Function("window", "document", "localStorage", SRC)(box.window, undefined, box.localStorage);
const YD = box.window.YDContinue;
console.log("导出接口: " + Object.keys(YD).join(", "));
function readCard(file) {
  const buf = fs.readFileSync(file); let off = 8; const found = {};
  while (off + 8 <= buf.length) { const len = buf.readUInt32BE(off), type = buf.toString("latin1", off + 4, off + 8); const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "tEXt" || type === "iTXt") { const z = data.indexOf(0), kw = data.subarray(0, z).toString("latin1");
      if (kw === "chara" || kw === "ccv3") { let payload; if (type === "tEXt") payload = Buffer.from(data.subarray(z + 1).toString("latin1"), "base64").toString("utf8"); else { const pa = data.subarray(z + 1); const p1 = pa.indexOf(0), p2 = pa.indexOf(0, p1 + 1), p3 = pa.indexOf(0, p2 + 1), p4 = pa.indexOf(0, p3 + 1); payload = pa.subarray(p4 + 1).toString("utf8"); } found[kw] = payload; } } off += 12 + len; }
  return JSON.parse(found.chara || found.ccv3);
}
const CHARS = "D:/AI/SillyTavern/Data/default-user/characters";
let yes = 0, no = 0; const yesList = [], noList = [];
for (const f of fs.readdirSync(CHARS).filter(x => x.endsWith(".png"))) {
  let ch; try { ch = { data: readCard(path.join(CHARS, f)).data }; } catch (_) { continue; }
  const det = YD.detectBlueprint(ch);
  const name = (ch.data && ch.data.name) || f;
  if (det.has) { yes++; if (yesList.length < 8) yesList.push(name.slice(0, 16) + "(" + (det.varName || "关键字") + ")"); }
  else { no++; if (noList.length < 5) noList.push(name.slice(0, 16)); }
}
console.log("");
console.log("全卡探测结果：有剧本系统 = " + yes + " 张 | 无 = " + no + " 张");
console.log("  有剧本示例: " + yesList.join(" / "));
console.log("  无剧本示例: " + noList.join(" / "));
const cfg = { advanceText: "请根据当前 {var}，推进至下一个 step", advanceTextFallback: "（推进到下一个剧情节点）" };
console.log("");
console.log("文案生成示例：");
console.log("  有剧本: " + YD.buildAdvanceText(cfg, { has: true, varName: "blueprint_controller" }));
console.log("  有剧本但只有关键字: " + YD.buildAdvanceText(cfg, { has: true, varName: null }));