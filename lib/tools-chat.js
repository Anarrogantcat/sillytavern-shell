// ── D 档：模型直连能力（绕过 ST 独立运行）──
// D16 独立对话助手（独立窗口直连模型）| D17 草稿生成器
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app } from 'electron';
import { fileURLToPath } from 'node:url';
import { detectModel, chatOnce } from './tools-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function registerChatTools(ctx) {
    const { ipcMain, dataRoot, app } = ctx;
    let chatWin = null;
    // B10 多会话：持久化到套壳 userData（不碰 ST）
    const sessionsDir = () => path.join(app.getPath('userData'), 'chat-sessions');
    function sessionsList() {
        const dir = sessionsDir();
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
            try {
                const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                return { id: f.replace(/\.json$/, ''), title: j.title || '未命名会话', count: (j.messages || []).length, updated: j.updated || 0 };
            } catch (_) { return null; }
        }).filter(Boolean).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    }
    function sessionSave(id, title, messages) {
        const dir = sessionsDir();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ id, title, messages, updated: Date.now() }, null, 2), 'utf8');
        return true;
    }
    function sessionLoad(id) {
        // 审计：会话 id 路径穿越防护
        const sid = String(id || '').replace(/[\\/]/g, '');
        if (!sid || sid.includes('..') || !/^[A-Za-z0-9_-]+$/.test(sid)) return null;
        const f = path.join(sessionsDir(), sid + '.json');
        if (!fs.existsSync(f)) return null;
        try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; }
    }
    function sessionDelete(id) {
        const sid = String(id || '').replace(/[\\/]/g, '');
        if (!sid || sid.includes('..') || !/^[A-Za-z0-9_-]+$/.test(sid)) return false;
        try { fs.rmSync(path.join(sessionsDir(), sid + '.json'), { force: true }); } catch (_) {}
        return true;
    }

    function openChatWindow() {
        if (chatWin && !chatWin.isDestroyed()) { chatWin.show(); chatWin.focus(); return; }
        chatWin = new BrowserWindow({
            width: 780, height: 640, title: '独立对话助手',
            backgroundColor: '#0f0f1a',
            // 审计 #10：preload.js 是 ESM，必须 sandbox:false（Electron 20+ 默认沙箱化，沙箱 preload 不支持 import）
            webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, '..', 'preload.js') },
        });
        chatWin.setMenuBarVisibility(false);
        chatWin.loadFile(path.join(__dirname, '..', 'chat.html'));
        chatWin.on('closed', () => { chatWin = null; });
        return chatWin;
    }

    ipcMain.handle('tools:chatOpen', () => { openChatWindow(); return true; });
    ipcMain.handle('tools:chatModel', () => detectModel(ctx));
    ipcMain.handle('tools:chatSend', async (e, text, sessionId) => {
        const model = detectModel(ctx);
        if (!model) return { error: '未检测到模型配置' };
        const sid = sessionId || 'default';
        const sess = sessionLoad(sid) || { id: sid, title: '', messages: [] };
        sess.messages.push({ role: 'user', content: String(text || '') });
        if (!sess.title) sess.title = String(text || '').slice(0, 24);
        try {
            // B11 RAG：检索知识库相关内容拼入提示（有文档时）
            let prompt = sess.messages.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`).join('\n');
            try {
                const hits = await ragSearchFor(ctx, prompt);
                if (hits.length) prompt = `参考知识（仅作背景，不要复述）:\n${hits.map(h => h.text).join('\n---\n')}\n\n${prompt}`;
            } catch (_) {}
            const reply = await chatOnce(model, prompt, 1024);
            sess.messages.push({ role: 'assistant', content: reply });
            sessionSave(sid, sess.title, sess.messages);
            return { reply, sessionId: sid, title: sess.title };
        } catch (err) {
            sess.messages.pop();
            return { error: err.message };
        }
    });
    ipcMain.handle('tools:chatSessions', () => sessionsList());
    ipcMain.handle('tools:chatLoad', (e, id) => sessionLoad(id));
    ipcMain.handle('tools:chatClear', (e, id) => sessionDelete(id));
    ipcMain.handle('tools:chatNew', () => {
        const id = 's' + Date.now().toString(36);
        sessionSave(id, '新对话', []);
        return id;
    });

    // ── D17 草稿生成器（工具箱内嵌）───────────────────────────────
    ipcMain.handle('tools:draftGenerate', async (e, prompt, maxTokens) => {
        const model = detectModel(ctx);
        if (!model) return { error: '未检测到模型配置' };
        try {
            const out = await chatOnce(model, String(prompt || ''), Number(maxTokens) || 512);
            return { text: out };
        } catch (err) { return { error: err.message }; }
    });

    return { openChatWindow };
}

// B11 RAG 检索（独立实现：扫描套壳 userData/rag-docs 的 txt/md/json，字符 n-gram 匹配）
let ragCache = null;
async function ragSearchFor(ctx, query) {
    try {
        const qk = String(query || '').toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean);
        if (!qk.length) return [];
        if (!ragCache) {
            ragCache = [];
            const root = path.join(app.getPath('userData'), 'rag-docs');
            if (fs.existsSync(root)) {
                for (const f of fs.readdirSync(root)) {
                    if (!/\.(txt|md|json)$/i.test(f)) continue;
                    let text = '';
                    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch (_) { continue; }
                    const name = f.replace(/\.\w+$/, '');
                    const chunks = [];
                    for (let i = 0; i < text.length; i += 500) {
                        const c = text.slice(i, i + 500);
                        chunks.push({ text: c, kw: c.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean) });
                    }
                    ragCache.push({ name, chunks });
                }
            }
        }
        const scored = [];
        for (const doc of ragCache) for (const chunk of doc.chunks) {
            let score = 0;
            for (const q of qk) if (chunk.kw.includes(q)) score += q.length >= 2 ? 2 : 1;
            if (score > 0) scored.push({ doc: doc.name, text: chunk.text, score });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, 4);
    } catch (_) { return []; }
}
