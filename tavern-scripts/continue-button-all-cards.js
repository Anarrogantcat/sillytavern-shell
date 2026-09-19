/**
 * ⚠ 已被取代（2026-09-20）：请改用 ST 扩展《剧情推进器 Plot Pilot》
 *   extensions/plot-pilot/（安装：node scripts/ext-install.mjs plot-pilot）
 *   本脚本保留仅作回滚用；如果两边同时启用会出现两套按钮，
 *   新版扩展检测到本脚本在场时会自动进入待命并提示。
 *
 * 脚本名称：ContinueButtonUI（通用版 v2）— 适配所有角色卡
 * 职责：在发送栏上方注入「▶ 继续 / ▶ 推进剧本步骤」
 * 适配逻辑：自动探测当前卡是否带「剧本 / blueprint / step」系统
 *   有 → 显示推进按钮，并使用卡里真实的变量名
 *   无 → 自动隐藏（可配置强制显示，用通用文案）
 * 依赖：酒馆助手提供的全局 SillyTavern.getContext()
 * 配置：localStorage['yd_continue_cfg_v2']，或 window.YDContinue.setConfig({...})
 */
(function () {
    const CFG_KEY = 'yd_continue_cfg_v2';
    const DEFAULTS = {
        enabled: true,
        continueText: '（按照当前剧情继续推演）',
        advanceText: '请根据当前 {var}，推进至下一个 step',
        advanceTextFallback: '（推进到下一个剧情节点）',
        showAdvanceWhenUnknown: false,
        pollMs: 300,
    };
    const BP_KEYS = ['blueprint_controller', 'blueprint_manager', 'blueprint_state', 'blueprint', '剧本控制器', '剧本控制'];
    const BP_HINTS = /blueprint|剧本|推进至下一个 ?step/i;

    function loadCfg() {
        try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); }
        catch (_) { return Object.assign({}, DEFAULTS); }
    }
    function saveCfg(cfg) { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (_) {} }

    function getChar() {
        try {
            const ctx = window.SillyTavern && window.SillyTavern.getContext ? window.SillyTavern.getContext() : null;
            const list = (ctx && ctx.characters) || [];
            const id = (ctx && (ctx.characterId !== undefined ? ctx.characterId : ctx.this_chid));
            return list[id] || null;
        } catch (_) { return null; }
    }
    function cardText(ch, limit) {
        if (!ch) return '';
        const d = ch.data || ch;
        const parts = [];
        try { parts.push(JSON.stringify(d.extensions || {})); } catch (_) {}
        parts.push(String(d.description || ''), String(d.personality || ''), String(d.scenario || ''));
        const entries = (d.character_book && d.character_book.entries) || [];
        for (const e of entries) parts.push(String(e.content || ''));
        return parts.join('\n').slice(0, limit || 400000);
    }
    function detectBlueprint(ch) {
        const text = cardText(ch);
        if (!text) return { has: false, varName: null };
        for (const k of BP_KEYS) if (text.indexOf(k) >= 0) return { has: true, varName: k };
        if (BP_HINTS.test(text)) return { has: true, varName: null };
        return { has: false, varName: null };
    }
    function buildAdvanceText(cfg, det) {
        const name = (det && det.varName) || '剧情蓝图';
        return String(cfg.advanceText || DEFAULTS.advanceText).split('{var}').join(name);
    }

    let pending = false;
    async function send(text) {
        if (pending) return;
        pending = true;
        try {
            const ta = document.querySelector('#send_textarea');
            const btn = document.querySelector('#send_but');
            if (!ta || !btn) return;
            ta.value = text;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            for (let i = 0; i < 20; i++) {
                const disabled = btn.classList.contains('disabled') || btn.disabled;
                if (!disabled) break;
                await new Promise(function (r) { setTimeout(r, 100); });
            }
            btn.click();
        } finally { setTimeout(function () { pending = false; }, 300); }
    }

    function injectUI() {
        const cfg = loadCfg();
        if (!cfg.enabled) return;
        if (document.getElementById('yd-quick-continue-wrapper')) return;
        const form = document.querySelector('#send_form');
        if (!form) return;

        const det = detectBlueprint(getChar());
        const showAdvance = det.has || cfg.showAdvanceWhenUnknown;
        const btnStyle = function (color) {
            return 'padding:5px 25px;color:' + color + ';border:1px solid ' + color + '80;border-radius:15px;cursor:pointer;' +
                'transition:.2s;background:rgba(0,0,0,.2);font-size:14px;font-weight:bold;user-select:none';
        };

        const wrap = document.createElement('div');
        wrap.id = 'yd-quick-continue-wrapper';
        wrap.style.cssText = 'width:100%;display:flex;justify-content:center;gap:15px;margin-bottom:5px;order:-1';

        const b1 = document.createElement('div');
        b1.id = 'yd-quick-continue-btn';
        b1.className = 'menu_button';
        b1.title = '快捷继续剧情（通用）';
        b1.style.cssText = btnStyle('#D4AF37');
        b1.textContent = '▶ 继续';
        b1.addEventListener('click', function () { send(loadCfg().continueText); });
        wrap.appendChild(b1);

        if (showAdvance) {
            const b2 = document.createElement('div');
            b2.id = 'yd-advance-script-btn';
            b2.className = 'menu_button';
            b2.title = det.has ? ('推进剧本步骤（检测到：' + (det.varName || '剧本关键字') + '）') : '推进剧情节点（未检测到剧本系统，用通用文案）';
            b2.style.cssText = btnStyle('#7CB342');
            b2.textContent = '▶ 推进剧本步骤';
            b2.addEventListener('click', function () {
                const c = loadCfg();
                const d2 = detectBlueprint(getChar());
                send(d2.has ? buildAdvanceText(c, d2) : c.advanceTextFallback);
            });
            wrap.appendChild(b2);
        }
        form.prepend(wrap);
    }

    let timer = null;
    function schedule() { if (timer) return; timer = setTimeout(function () { timer = null; injectUI(); }, loadCfg().pollMs); }
    function start() {
        injectUI();
        try { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); } catch (_) {}
    }

    window.YDContinue = {
        detectBlueprint: detectBlueprint,
        cardText: cardText,
        buildAdvanceText: buildAdvanceText,
        get cfg() { return loadCfg(); },
        setConfig: function (patch) {
            const c = Object.assign(loadCfg(), patch || {});
            saveCfg(c);
            const w = document.getElementById('yd-quick-continue-wrapper');
            if (w) w.remove();
            injectUI();
            return c;
        },
        recheck: function () {
            const w = document.getElementById('yd-quick-continue-wrapper');
            if (w) w.remove();
            injectUI();
            return detectBlueprint(getChar());
        },
    };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    }
})();
