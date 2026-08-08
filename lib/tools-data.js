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

    // ── IPC ────────────────────────────────────────────────────────
    ipcMain.handle('tools:searchChats', (e, kw) => searchChats(kw));
    ipcMain.handle('tools:summarizeChat', async () => { try { return await summarizeChat(); } catch (e) { return { error: e.message }; } });
    ipcMain.handle('tools:listCharacters', () => listCharacters());
    ipcMain.handle('tools:exportCharacters', async () => { try { return await exportCharacters(); } catch (e) { return { error: e.message }; } });
    ipcMain.handle('tools:chatStats', () => chatStats());

    return { searchChats, summarizeChat, notifyGenerated, listCharacters, chatStats };
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
