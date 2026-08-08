// ── D 档：模型直连能力（绕过 ST 独立运行）──
// D16 独立对话助手（独立窗口直连模型）| D17 草稿生成器
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { detectModel, chatOnce } from './tools-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function registerChatTools(ctx) {
    const { ipcMain, dataRoot } = ctx;
    let chatWin = null;
    const history = []; // [{role, content}]

    function openChatWindow() {
        if (chatWin && !chatWin.isDestroyed()) { chatWin.show(); chatWin.focus(); return; }
        chatWin = new BrowserWindow({
            width: 780, height: 640, title: '独立对话助手',
            backgroundColor: '#0f0f1a',
            webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, '..', 'preload.js') },
        });
        chatWin.setMenuBarVisibility(false);
        chatWin.loadFile(path.join(__dirname, '..', 'chat.html'));
        chatWin.on('closed', () => { chatWin = null; });
        return chatWin;
    }

    ipcMain.handle('tools:chatOpen', () => { openChatWindow(); return true; });
    ipcMain.handle('tools:chatModel', () => detectModel(ctx));
    ipcMain.handle('tools:chatSend', async (e, text) => {
        const model = detectModel(ctx);
        if (!model) return { error: '未检测到模型配置' };
        history.push({ role: 'user', content: String(text || '') });
        try {
            const reply = await chatOnce(model, history.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`).join('\n'), 1024);
            history.push({ role: 'assistant', content: reply });
            return { reply };
        } catch (err) {
            history.pop();
            return { error: err.message };
        }
    });
    ipcMain.handle('tools:chatClear', () => { history.length = 0; return true; });

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
