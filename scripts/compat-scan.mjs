// scripts/compat-scan.mjs — 角色卡/预设「能力档案」静态扫描器
// 用途：为「兼容与检测」工具箱页签与 card-compat 扩展提供判定依据（只读，不改任何文件）
// 用法：node scripts/compat-scan.mjs [dataRoot] [outFile]
import fs from 'node:fs';
import path from 'node:path';

const dataRoot = process.argv[2] || 'D:/AI/SillyTavern/Data';
const outFile = process.argv[3] || path.resolve('compat-profile.json');
const charDir = path.join(dataRoot, 'default-user/characters');
const presetDir = path.join(dataRoot, 'default-user/OpenAI Settings');
const settingsFile = path.join(dataRoot, 'default-user/settings.json');

const TAG_RE = /<\/?([A-Za-z][A-Za-z0-9_!-]*)\s*\/?>/g;
const HIDE_RE = /隐藏|删除|去除|hide|remove|strip/i;
const DATA_RE = /UpdateVariable|UpdateVariable|变量|setvar|getvar/i;
const STATUS_RE = /状态栏|status|StatusPlaceHolder|StatusBar/i;

function readCardJson(file) {
  const buf = fs.readFileSync(file);
  let off = 8; const found = {};
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'tEXt' || type === 'iTXt') {
      const z = data.indexOf(0);
      const kw = data.subarray(0, z).toString('latin1');
      if (kw === 'chara' || kw === 'ccv3') {
        let payload;
        if (type === 'tEXt') payload = Buffer.from(data.subarray(z + 1).toString('latin1'), 'base64').toString('utf8');
        else {
          const pa = data.subarray(z + 1);
          const p1 = pa.indexOf(0), p2 = pa.indexOf(0, p1 + 1), p3 = pa.indexOf(0, p2 + 1), p4 = pa.indexOf(0, p3 + 1);
          payload = pa.subarray(p4 + 1).toString('utf8');
        }
        found[kw] = payload;
      }
    }
    off += 12 + len;
  }
  const raw = found.chara || found.ccv3;
  return raw ? JSON.parse(raw) : null;
}

function tagsOf(text) {
  const set = new Set();
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(String(text || '')))) set.add(m[1].replace(/\/$/, ''));
  return [...set];
}

function scanCard(file) {
  const card = readCardJson(file);
  if (!card) return null;
  const d = card.data || card;
  const ext = d.extensions || {};
  const scripts = (ext.regex_scripts || []).filter(s => !s.disabled);
  const allScripts = ext.regex_scripts || [];
  const anchorTags = new Set(), dataTags = new Set(), hideTargets = new Set();
  for (const s of allScripts) {
    const t = tagsOf(s.findRegex);
    const isHide = HIDE_RE.test(String(s.scriptName || ''));
    for (const tag of t) {
      if (DATA_RE.test(tag)) dataTags.add(tag);
      else if (isHide) hideTargets.add(tag);
      else anchorTags.add(tag);
    }
  }
  const helperRaw = ext.tavern_helper;
  const helperScripts = helperRaw && Array.isArray(helperRaw.scripts) ? helperRaw.scripts : [];
  const helperText = helperScripts.map(s => String(s.content || '')).join('\n');
  const book = (d.character_book?.entries || []);
  const bookText = book.map(e => String(e.content || '')).join('\n');
  const helperRenders = helperScripts.length > 0 && STATUS_RE.test(helperText);
  const anchorSource = helperRenders ? 'helper' : (scripts.some(s => tagsOf(s.findRegex).length && !HIDE_RE.test(String(s.scriptName || ''))) ? 'regex' : 'none');
  const dataSource = dataTags.size ? 'regex' : (helperScripts.length && DATA_RE.test(helperText) ? 'helper' : 'none');
  return {
    name: d.name || path.basename(file, '.png'),
    file: path.basename(file),
    spec: card.spec || 'v1',
    regexTotal: allScripts.length,
    regexEnabled: scripts.length,
    helperScripts: helperScripts.length,
    helperRenders,
    worldbookEntries: book.length,
    worldbookChars: [...bookText].length,
    worldbookHasStatus: STATUS_RE.test(bookText),
    worldbookHasVar: DATA_RE.test(bookText),
    depthPrompt: !!(ext.depth_prompt && ext.depth_prompt.prompt),
    anchorTags: [...anchorTags],
    dataTags: [...dataTags],
    hideTargets: [...hideTargets],
    anchorSource,
    dataSource,
    risk: (scripts.some(s => HIDE_RE.test(String(s.scriptName || ''))) && anchorTags.size === 0) ? 'hide-without-anchor' : 'ok',
  };
}

const cards = [];
for (const f of fs.readdirSync(charDir)) {
  if (!/\.(png|json)$/i.test(f)) continue;
  try {
    const info = f.toLowerCase().endsWith('.json')
      ? (() => { const j = JSON.parse(fs.readFileSync(path.join(charDir, f), 'utf8')); return scanCardObject(j, f); })()
      : scanCard(path.join(charDir, f));
    if (info) cards.push(info);
  } catch (e) { cards.push({ name: f, file: f, error: e.message }); }
}

function scanCardObject(j, f) {
  return scanCard(fs.existsSync(path.join(charDir, f)) ? path.join(charDir, f) : f);
}

// 全局作用域：settings.json（该文件含控制字符，JSON.parse 会失败 → 逐行正则提取）
let globalScope = { helperGlobal: null, helperPresets: [], regexScripts: 0 };
try {
  const raw = fs.readFileSync(settingsFile, 'utf8');
  const mGlobal = raw.match(/"script"\s*:\s*\{[\s\S]{0,200}?"global"\s*:\s*(true|false)/);
  const mPresets = raw.match(/"script"\s*:\s*\{[\s\S]{0,600}?"presets"\s*:\s*\[([\s\S]*?)\]/);
  globalScope.helperGlobal = mGlobal ? mGlobal[1] === 'true' : null;
  globalScope.helperPresets = mPresets ? [...mPresets[1].matchAll(/"([^"]+)"/g)].map(x => x[1]) : [];
  globalScope.regexScripts = (raw.match(/"regex_scripts"\s*:\s*\[/g) || []).length;
} catch (e) { globalScope.error = e.message; }

const presets = [];
try {
  for (const f of fs.readdirSync(presetDir)) {
    if (!f.endsWith('.json')) continue;
    let j = null;
    try { j = JSON.parse(fs.readFileSync(path.join(presetDir, f), 'utf8')); } catch (_) {}
    presets.push({
      file: f,
      hasScripts: !!(j && (j.regex_scripts || j.tavern_helper || j.scripts)),
      prompts: j?.prompts?.length ?? null,
      enabledPrompts: j?.prompts?.filter(p => p.enabled !== false).length ?? null,
      maxTokens: j?.max_tokens ?? null,
      streamOpenai: j?.stream_openai ?? null,
      freqPenalty: j?.frequency_penalty ?? null,
      maxContext: j?.openai_max_context ?? null,
    });
  }
} catch (e) { /* ignore */ }

const summary = {
  scannedAt: new Date().toISOString(),
  dataRoot,
  cards: cards.length,
  cardErrors: cards.filter(c => c.error).length,
  withRegex: cards.filter(c => c.regexEnabled > 0).length,
  withHelper: cards.filter(c => c.helperScripts > 0).length,
  withHelperRender: cards.filter(c => c.helperRenders).length,
  withWorldbookStatus: cards.filter(c => c.worldbookHasStatus).length,
  withWorldbookVar: cards.filter(c => c.worldbookHasVar).length,
  anchorSource: {
    regex: cards.filter(c => c.anchorSource === 'regex').length,
    helper: cards.filter(c => c.anchorSource === 'helper').length,
    none: cards.filter(c => c.anchorSource === 'none').length,
  },
  dataSource: {
    regex: cards.filter(c => c.dataSource === 'regex').length,
    helper: cards.filter(c => c.dataSource === 'helper').length,
    none: cards.filter(c => c.dataSource === 'none').length,
  },
  riskCards: cards.filter(c => c.risk !== 'ok').map(c => c.name),
  anchorTagHistogram: {},
  dataTagHistogram: {},
};
for (const c of cards) for (const t of c.anchorTags || []) summary.anchorTagHistogram[t] = (summary.anchorTagHistogram[t] || 0) + 1;
for (const c of cards) for (const t of c.dataTags || []) summary.dataTagHistogram[t] = (summary.dataTagHistogram[t] || 0) + 1;

const profile = { summary, globalScope, presets, cards };
fs.writeFileSync(outFile, JSON.stringify(profile, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log('');
console.log('全局作用域: ' + JSON.stringify(globalScope));
console.log('预设: ' + presets.length + ' 个，含脚本的预设数 = ' + presets.filter(p => p.hasScripts).length);
console.log('档案已写入: ' + outFile);
