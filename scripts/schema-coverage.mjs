// scripts/schema-coverage.mjs — 用本地角色卡语料实测「MVU Zod 结构能静态覆盖多少」
// 用法：node scripts/schema-coverage.mjs [角色卡目录]（默认读 ST_CHARS 或标准数据目录）
import fs from 'node:fs';
import path from 'node:path';
import { schemaHints } from '../extensions/card-compat/logic.js';

const DIR = process.argv[2] || process.env.ST_CHARS || 'D:/AI/SillyTavern/Data/default-user/characters';

function cardChara(png) {
    const buf = fs.readFileSync(png);
    let off = 8, chara = null;
    while (off + 8 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        if (type === 'tEXt') {
            const d = buf.slice(off + 8, off + 8 + len);
            const z = d.indexOf(0);
            if (z > 0 && d.toString('latin1', 0, z) === 'chara') chara = d.slice(z + 1).toString('latin1');
        }
        if (type === 'IEND') break;
        off += 12 + len;
    }
    return chara ? JSON.parse(Buffer.from(chara, 'base64').toString('utf8')) : null;
}

const files = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.png'));
const rows = [];
for (const f of files) {
    let card = null;
    try { card = cardChara(path.join(DIR, f)); } catch (_) { continue; }
    if (!card) continue;
    const scripts = ((card.data && card.data.extensions && card.data.extensions.tavern_helper) || {}).scripts || [];
    const texts = scripts.map((s) => String(s.content || ''));
    const schemaTexts = texts.filter((t) => /registerMvuSchema|z\s*\.\s*(?:strict|loose)?[oO]bject\s*\(/.test(t));
    if (!schemaTexts.length) continue;
    const h = schemaHints(schemaTexts.join(String.fromCharCode(10)));
    const un = {};
    for (const u of h.unverifiable) un[u.kind] = (un[u.kind] || 0) + 1;
    rows.push({
        name: String(card.data.name || f),
        clamps: h.clamps.length, bounds: h.bounds.length, types: h.types.length, enums: h.enums.length,
        defaults: h.defaults.length, objects: h.objects.length, records: h.records.length,
        helpers: Object.keys(h.helpers).length, unverifiable: h.unverifiable.length, kinds: un,
    });
}

const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
const withUn = rows.filter((r) => r.unverifiable > 0);
const noRoot = rows.filter((r) => r.kinds['no-root-schema']);
console.log('卡片总数(带 schema)=' + rows.length + ' / 目录内 PNG=' + files.length);
console.log('约束合计: clamps=' + sum('clamps') + ' bounds=' + sum('bounds') + ' types=' + sum('types') + ' enums=' + sum('enums') + ' defaults=' + sum('defaults') + ' objects=' + sum('objects') + ' records=' + sum('records'));
console.log('完全可静态校验的卡=' + (rows.length - withUn.length) + '/' + rows.length + '；有无法离线校验构造的卡=' + withUn.length + '；找不到根 schema=' + noRoot.length);
const hist = {};
for (const r of rows) for (const k of Object.keys(r.kinds)) hist[k] = (hist[k] || 0) + 1;
console.log('无法离线校验的构造（按卡数）: ' + JSON.stringify(hist));
console.log('平均每卡: types=' + (rows.length ? (sum('types') / rows.length).toFixed(1) : 0) + ' defaults=' + (rows.length ? (sum('defaults') / rows.length).toFixed(1) : 0));
if (withUn.length) {
    console.log('--- 有无法离线校验构造的卡（前 20）---');
    for (const r of withUn.slice(0, 20)) console.log('  ' + r.name.slice(0, 40) + ' -> ' + JSON.stringify(r.kinds));
}