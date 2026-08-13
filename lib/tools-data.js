// ── B 档：只读数据能力（扫描发现 + 可降级，ST 更新不崩）──
// B7 聊天全文搜索 | B8 剧情总结导出 | B9 生成完成通知 | B10 角色卡导出 | B11 聊天统计
import fs from 'node:fs';
import path from 'node:path';
import { Notification } from 'electron';

export function registerDataTools(ctx) {
    const { ipcMain, app, dialog, shell, dataRoot, sillyTavernRoot, terminalWrite, win, getSettings } = ctx;

    const chatsRoot = () => path.join(dataRoot, 'default-user', 'chats');
    const charsRoot = () => path.join(dataRoot, 'default-user', 'characters');

    // ── B7 聊天全文搜索（跨角色卡）──────────────────────────────────
    function scanChats() {
        const root = chatsRoot();
        if (!fs.existsSync(root)) return [];
        const out = [];
        try {
            for (const charDir of fs.readdirSync(root)) {
                const dir = path.join(root, charDir);
                if (!fs.statSync(dir).isDirectory()) continue;
                for (const f of fs.readdirSync(dir)) {
                    if (!f.endsWith('.jsonl')) continue;
                    out.push({ char: charDir, file: path.join(dir, f) });
                }
            }
        } catch (_) {}
        return out;
    }
    function searchChats(keyword, limit = 60) {
        const kw = String(keyword || '').trim().toLowerCase();
        if (!kw) return { results: [], totalFiles: 0 };
        const files = scanChats();
        const results = [];
        let scanned = 0;
        for (const { char, file } of files) {
            let text = '';
            try { text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
            scanned++;
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line.trim() || line.includes('chat_metadata')) continue;
                let msg = null;
                try { msg = JSON.parse(line); } catch (_) { continue; }
                if (!msg || !msg.mes) continue;
                if (msg.mes.toLowerCase().includes(kw)) {
                    results.push({
                        char, file: path.basename(file),
                        isUser: !!msg.is_user, name: msg.name || (msg.is_user ? '用户' : '角色'),
                        snippet: msg.mes.slice(0, 200),
                        date: msg.send_date || '',
                    });
                    if (results.length >= limit) return { results, totalFiles: scanned, truncated: true };
                }
            }
        }
        return { results, totalFiles: scanned };
    }

    // ── B8 剧情总结导出 ─────────────────────────────────────────────
    async function summarizeChat(maxMsgs = 2000) {
        const files = scanChats();
        if (!files.length) throw new Error('没有找到聊天记录');
        // 取最新的聊天文件（按 mtime）
        files.sort((a, b) => fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs);
        const f = files[0];
        let text = '';
        try { text = fs.readFileSync(f.file, 'utf8'); } catch (e) { throw new Error('读取聊天失败: ' + e.message); }
        const msgs = text.split('\n').filter(l => l.trim() && !l.includes('chat_metadata')).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean).slice(-maxMsgs);
        // 直连模型总结（与测速同一套配置检测）
        const model = detectModel(ctx);
        if (!model?.url || !model?.model) throw new Error('未检测到模型配置，无法总结');
        const transcript = msgs.map(m => `${m.is_user ? '用户' : (m.name || '角色')}: ${String(m.mes || '').slice(0, 800)}`).join('\n');
        const prompt = `请用中文总结以下对话的剧情进展：主要事件、人物关系变化、当前状态。用简洁条目列出。\n\n${transcript.slice(-6000)}`;
        const summary = await chatOnce(model, prompt, 800);
        // 导出
        const outDir = path.join(app.getPath('userData'), 'summaries');
        fs.mkdirSync(outDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13);
        const dest = path.join(outDir, `剧情总结-${f.char}-${stamp}.md`);
        fs.writeFileSync(dest, `# 剧情总结 - ${f.char}\n\n${summary}\n`, 'utf8');
        return { summary, dest, char: f.char };
    }

    // ── B9 生成完成通知 ────────────────────────────────────────────
    function notifyGenerated(charName, tokens) {
        const s = getSettings();
        if (s.notifyGenerated === false) return;
        const n = new Notification({ title: '💬 回复生成完成', body: `${charName} 的新回复已生成${tokens ? `（约 ${tokens} token）` : ''}` });
        n.on('click', () => { win()?.show(); win()?.focus(); });
        n.show();
    }

    // ── B10 角色卡批量导出 ─────────────────────────────────────────
    function listCharacters() {
        const root = charsRoot();
        if (!fs.existsSync(root)) return [];
        try {
            return fs.readdirSync(root).filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));
        } catch (_) { return []; }
    }
    async function exportCharacters() {
        const cards = listCharacters();
        if (!cards.length) throw new Error('没有找到角色卡');
        const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择角色卡导出目录' });
        if (r.canceled || !r.filePaths[0]) return { canceled: true };
        const dest = path.join(r.filePaths[0], 'ST-角色卡导出');
        fs.mkdirSync(dest, { recursive: true });
        let n = 0;
        for (const c of cards) {
            try { fs.copyFileSync(path.join(charsRoot(), c), path.join(dest, c)); n++; } catch (_) {}
        }
        return { canceled: false, count: n, dest };
    }

    // ── B11 聊天统计 ───────────────────────────────────────────────
    function chatStats() {
        const files = scanChats();
        const out = { chars: files.length, totalMessages: 0, totalChars: 0, userChars: 0, replyChars: 0, replies: 0, userMsgs: 0, perChar: [] };
        for (const { char, file } of files) {
            let text = '';
            try { text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
            const msgs = text.split('\n').filter(l => l.trim() && !l.includes('chat_metadata'));
            const c = { char, messages: 0, chars: 0, replies: 0, replyChars: 0 };
            for (const line of msgs) {
                let m = null; try { m = JSON.parse(line); } catch (_) { continue; }
                if (!m || !m.mes) continue;
                c.messages++; c.chars += m.mes.length;
                out.totalMessages++; out.totalChars += m.mes.length;
                if (m.is_user) { out.userMsgs++; out.userChars += m.mes.length; }
                else { c.replies++; c.replyChars += m.mes.length; out.replies++; out.replyChars += m.mes.length; }
            }
            out.perChar.push(c);
        }
        out.perChar.sort((a, b) => b.chars - a.chars);
        return out;
    }

    // ── B5 聊天导出 HTML（阅读器样式）──────────────────────────────
    function exportChatHtml() {
        const files = scanChats();
        if (!files.length) throw new Error('没有找到聊天记录');
        files.sort((a, b) => fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs);
        const f = files[0];
        let text = '';
        try { text = fs.readFileSync(f.file, 'utf8'); } catch (e) { throw new Error('读取聊天失败: ' + e.message); }
        const msgs = text.split('\n').filter(l => l.trim() && !l.includes('chat_metadata')).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
        const rows = msgs.map(m => {
            const who = m.is_user ? 'user' : 'char';
            const name = (m.name || (m.is_user ? '用户' : '角色')).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
            const body = String(m.mes || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])).replace(/\n/g, '<br>');
            const date = (m.send_date || '').replace('T', ' ').slice(0, 16);
            return `<div class="msg ${who}"><div class="meta">${name} · ${date}</div><div class="body">${body}</div></div>`;
        }).join('\n');
        const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>聊天记录 - ${f.char}</title>
<style>body{max-width:860px;margin:0 auto;padding:24px;background:#12121f;color:#d8d8e8;font-family:'Microsoft YaHei',sans-serif}h1{font-size:20px;color:#9d8cf0}.msg{margin:14px 0;padding:12px 14px;border-radius:10px;line-height:1.7}.msg .meta{font-size:12px;color:#8080a8;margin-bottom:6px}.msg.user{background:#2a2550;margin-left:12%}.msg.char{background:#1d1d33;margin-right:12%}</style></head>
<body><h1>${f.char} · 共 ${msgs.length} 条消息</h1>${rows}</body></html>`;
        const outDir = path.join(app.getPath('userData'), 'exports');
        fs.mkdirSync(outDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13);
        const dest = path.join(outDir, `聊天记录-${f.char}-${stamp}.html`);
        fs.writeFileSync(dest, html, 'utf8');
        return { dest, char: f.char, count: msgs.length };
    }

    // ── B6 角色卡速览（解析 PNG 内嵌 JSON，只读）────────────────────
    function cardPreview(cardName) {
        const file = path.join(charsRoot(), String(cardName || ''));
        if (!fs.existsSync(file)) throw new Error('角色卡不存在: ' + cardName);
        let json = null;
        try {
            const buf = fs.readFileSync(file);
            const str = buf.toString('utf8');
            // PNG tEXt chunk: 找 "chara" 或最后一个 <json>...</json>
            const m = str.match(/<json>([\s\S]*?)<\/json>/);
            if (m) json = JSON.parse(m[1]);
            else {
                // tEXt 块: 定位 'chara\0' 后的 JSON
                const i = str.indexOf('chara\x00');
                if (i >= 0) {
                    const seg = str.slice(i + 6, i + 6 + 40000);
                    const jm = seg.match(/^([\s\S]*?)(?:\x00|$)/);
                    if (jm) json = JSON.parse(jm[1].trim());
                }
            }
        } catch (_) { json = null; }
        if (!json) throw new Error('无法解析角色卡数据（可能不是 ST 角色卡）');
        const spec = json.spec || json.data?.spec || {};
        const first = json.data?.first_mes || '';
        return {
            name: spec.name || cardName.replace(/\.\w+$/, ''),
            description: spec.description || '',
            personality: spec.personality || '',
            scenario: spec.scenario || '',
            firstMes: String(first).slice(0, 300),
            mesExamples: (json.data?.mes_example || '').slice(0, 300),
        };
    }

    // ── B7 世界书查看（只读）───────────────────────────────────────
    function worldBooks() {
        const root = path.join(dataRoot, 'default-user', 'worlds');
        if (!fs.existsSync(root)) return [];
        try {
            return fs.readdirSync(root).filter(f => f.endsWith('.json')).map(f => {
                let data = {};
                try { data = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); } catch (_) {}
                const entries = (data.entries || []).map(e => ({ key: e.uid, comment: e.comment || '', content: String(e.content || '').slice(0, 200) }));
                return { name: data.name || f.replace(/\.json$/, ''), entries: entries.slice(0, 50) };
            });
        } catch (_) { return []; }
    }

    // ── B11 本地知识库 RAG（简化版：字符 n-gram 相似度检索）────────
    const ragDocs = []; // [{name, chunks: [{text, kw}]}]
    let ragLoaded = false;
    function ragLoad() {
        if (ragLoaded) return;
        ragLoaded = true;
        const root = path.join(app.getPath('userData'), 'rag-docs');
        if (!fs.existsSync(root)) return;
        try {
            for (const f of fs.readdirSync(root)) {
                if (!/\.(txt|md|json)$/i.test(f)) continue;
                let text = '';
                try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch (_) { continue; }
                const name = f.replace(/\.\w+$/, '');
                const chunks = [];
                const size = 500;
                for (let i = 0; i < text.length; i += size) {
                    const c = text.slice(i, i + size);
                    chunks.push({ text: c, kw: c.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean) });
                }
                ragDocs.push({ name, chunks });
            }
        } catch (_) {}
    }
    function ragSearch(query, topK = 4) {
        ragLoad();
        const qk = String(query || '').toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean);
        if (!qk.length || !ragDocs.length) return [];
        const scored = [];
        for (const doc of ragDocs) for (const chunk of doc.chunks) {
            let score = 0;
            for (const q of qk) if (chunk.kw.includes(q)) score += q.length >= 2 ? 2 : 1;
            if (score > 0) scored.push({ doc: doc.name, text: chunk.text, score });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    }

    // ── IPC ────────────────────────────────────────────────────────
    ipcMain.handle('tools:searchChats', (e, kw) => searchChats(kw));
    ipcMain.handle('tools:summarizeChat', async () => { try { return await summarizeChat(); } catch (e) { return { error: e.message }; } });
    ipcMain.handle('tools:listCharacters', () => listCharacters());
    ipcMain.handle('tools:exportCharacters', async () => { try { return await exportCharacters(); } catch (e) { return { error: e.message }; } });
    ipcMain.handle('tools:chatStats', () => chatStats());
    ipcMain.handle('tools:exportChatHtml', async () => { try { return await exportChatHtml(); } catch (e) { return { error: e.message }; } });
    ipcMain.handle('tools:cardPreview', (e, name) => { try { return cardPreview(name); } catch (err) { return { error: err.message }; } });
    ipcMain.handle('tools:worldBooks', () => worldBooks());
    ipcMain.handle('tools:ragSearch', (e, q) => ragSearch(q));

    return { searchChats, summarizeChat, notifyGenerated, listCharacters, chatStats, exportChatHtml, cardPreview, worldBooks, ragSearch };
}

// ── 共享：模型配置检测 + 单次对话（与 bench 同源，独立实现）──────
function detectModel(ctx) {
    try {
        const s = JSON.parse(fs.readFileSync(path.join(ctx.dataRoot, 'default-user', 'settings.json'), 'utf8'));
        const oai = s.oai_settings || {};
        const src = oai.chat_completion_source || 'custom';
        const map = {
            custom: ['custom_url', 'custom_model'], openai: ['openai_url', 'openai_model'],
            ollama: ['ollama_url', 'ollama_model'], openrouter: ['openrouter_url', 'openrouter_model'],
        };
        const keys = map[src];
        let url = '', model = '';
        if (keys) { url = oai[keys[0]] || ''; model = oai[keys[1]] || ''; }
        if (!url && oai.custom_url) { url = oai.custom_url; if (!model) model = oai.custom_model; }
        return url && model ? { url, model } : null;
    } catch (_) { return null; }
}
async function chatOnce(model, prompt, maxTokens = 512) {
    const isOllama = /(localhost|127\.0\.0\.1):11434/i.test(model.url);
    const base = model.url.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
    if (isOllama) {
        const r = await fetch(base + '/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: model.model, messages: [{ role: 'user', content: prompt }], stream: false, options: { num_predict: maxTokens } }),
            signal: AbortSignal.timeout(300000),
        });
        if (!r.ok) throw new Error(`模型请求失败 HTTP ${r.status}`);
        const j = await r.json();
        return j.message?.content || '';
    }
    const r = await fetch(model.url.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, stream: false }),
        signal: AbortSignal.timeout(300000),
    });
    if (!r.ok) throw new Error(`模型请求失败 HTTP ${r.status}`);
    const j = await r.json();
    return j.choices?.[0]?.message?.content || '';
}
export { detectModel, chatOnce };
