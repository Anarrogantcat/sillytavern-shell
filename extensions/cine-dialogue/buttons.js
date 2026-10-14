/**
 * 分镜对话 · 发送栏按钮（用户 2026-10-14：「在这里增加功能按钮」）
 *
 * 位置：那个按钮栏是 card-compat 的 `#cc-var-bar`。
 * ★ 规矩（AGENTS §0.3.1）：**不改别的扩展的代码** ✗ ⇒ 我们只**追加**自己的按钮；
 *   容器不在（没装 card-compat / 它关掉了）⇒ 我们自己起一条 `#cd-bar` ✓
 *
 * 三个按钮（都是今天踩到的坑一键化）：
 *   ① 重渲染本楼   —— 让当前楼重走 messageFormatting（标签裸露 / 没生效时点一下）
 *   ② 诊断本楼     —— 认得出几行 / 哪行没认出来 / 各层统计，复制到剪贴板
 *   ③ 本卡生效开关 —— 就是面板里的逐卡开关，这里给个快入口
 *
 * 依赖全部由 index.js 传进来（避免循环 import ✓）
 */

let DEPS = null;

function toast(msg, kind) {
    try { if (typeof toastr !== 'undefined') toastr[kind || 'success'](String(msg)); } catch (_) { }
    try { console.info('[' + (DEPS && DEPS.EXT_ID || 'cine-dialogue') + '] ' + msg); } catch (_) { }
}

/** 最后一条「非用户」楼层号；onlyMine = 只要我们能接手的那些 */
function lastMesId(onlyMine) {
    try {
        const ctx = DEPS.getContext();
        const chat = ctx.chat || [];
        const c = DEPS.effectiveConfig();
        const layers = DEPS.allLayers(c);
        for (let i = chat.length - 1; i >= 0; i--) {
            const m = chat[i];
            if (!m || m.is_user) continue;
            if (!onlyMine) return i;
            const raw = String(m.mes || (m.extra && m.extra.display_text) || '');
            if (DEPS.hasOurLines(DEPS.mergeSplitTags(raw), layers)) return i;
        }
    } catch (_) { }
    return -1;
}

/** ① 重渲染本楼 */
export function cdRerenderLast() {
    try {
        const ctx = DEPS.getContext();
        const id = lastMesId(false);
        if (id < 0 || typeof ctx.updateMessageBlock !== 'function') {
            toast('找不到可重渲染的楼层', 'warning');
            return;
        }
        ctx.updateMessageBlock(id, ctx.chat[id], { rerenderMessage: true });
        toast('已重渲染第 ' + (id + 1) + ' 楼');
    } catch (e) {
        toast('重渲染失败：' + e.message, 'error');
    }
}

/** ② 诊断本楼 */
export function cdDiagnoseLast() {
    try {
        const ctx = DEPS.getContext();
        const id = lastMesId(true);
        if (id < 0) {
            toast('这条聊天里没有我们的分镜行', 'warning');
            return;
        }
        const c = DEPS.effectiveConfig();
        const layers = DEPS.allLayers(c);
        const msg = ctx.chat[id] || {};
        const raw = String(msg.mes || (msg.extra && msg.extra.display_text) || '');
        const merged = DEPS.mergeSplitTags(raw);
        const NL = String.fromCharCode(10);
        let rows = 0, narrs = 0, texts = 0;
        const per = {};
        const suspect = [];
        for (const ln of merged.split(NL)) {
            const t = ln.trim();
            if (!t) continue;
            const p = DEPS.parseLine(t, layers, !!c.lenientLayers);
            if (p.kind === 'row') { rows++; per[p.layer] = (per[p.layer] || 0) + 1; }
            else if (p.kind === 'narr') narrs++;
            else {
                texts++;
                if (suspect.length < 6 && /[·・]/.test(t)) suspect.push(t.slice(0, 40));
            }
        }
        const r = DEPS.renderMessageHTML(raw, {}, c);
        const report = [
            '【分镜对话 · 本楼诊断】第 ' + (id + 1) + ' 楼',
            '原文 ' + raw.length + ' 字 · 标签合并：' + (merged !== raw ? '有（' + (raw.split(NL).length - merged.split(NL).length) + ' 行）' : '无'),
            '分镜行 ' + rows + ' · 旁白 ' + narrs + ' · 其它行 ' + texts,
            '各层统计：' + JSON.stringify(per),
            '我们接手：' + (r ? '是' : '否'),
            suspect.length ? ('疑似没认出的行：' + suspect.join(' ｜ ')) : '没有疑似漏认的行',
            '逐卡开关：' + (() => { try { const k = DEPS.cardKey(); const pc = (DEPS.cfg().perCard || {})[k] || {}; return (pc.off ? '不生效' : '生效') + '（' + String(k).slice(0, 18) + '）'; } catch (_) { return '取不到'; } })(),
        ].join(NL);
        try { if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(report); } catch (_) { }
        try { console.info('[cine-dialogue] 本楼诊断' + NL + report); } catch (_) { }
        toast('诊断已复制到剪贴板（详见表控制台）');
    } catch (e) {
        toast('诊断失败：' + e.message, 'error');
    }
}

/** ③ 本卡生效 / 不生效
 *  ★ 1.8.0：卡自带前端时**默认已经不动作了**（autoOff）⇒ 这个按钮在这种卡上的语义改成
 *    「**强制启用**（我知道可能和卡的美化打架）」✓ 再按一次取消强制 ✓
 */
export function cdToggleCardOff() {
    try {
        const k = DEPS.cardKey();
        if (!k) { toast('拿不到当前卡的键，无法切换', 'warning'); return; }
        const c = DEPS.cfg();
        const pc = { ...(c.perCard || {}) };
        const cur = { ...(pc[k] || {}) };
        const fe = (typeof DEPS.cardHasFrontend === 'function') ? DEPS.cardHasFrontend() : false;
        const autoOff = (c.autoOffCardFrontend !== false);
        if (fe && autoOff) {
            if (cur.force === true) {
                delete cur.force;
                toast('已取消强制启用 —— 这张卡自带前端，回到「不动作」✓');
            } else {
                cur.force = true;
                cur.off = false;
                toast('已强制在这张卡上启用 ⚠ 它自带前端，可能与卡的美化冲突');
            }
        } else {
            cur.off = !cur.off;
            toast('本卡已' + (cur.off ? '设为不生效（原样交给 ST）' : '恢复生效'));
        }
        pc[k] = cur;
        c.perCard = pc;
        DEPS.saveSettingsDebounced();
    } catch (e) {
        toast('切换失败：' + e.message, 'error');
    }
}

const DEFS = [
    ['cd-btn-rerender', '重渲染本楼', cdRerenderLast],
    ['cd-btn-diagnose', '诊断本楼', cdDiagnoseLast],
    ['cd-btn-off', '本卡生效/不生效', cdToggleCardOff],
];

/** 幂等挂载：优先追加进 #cc-var-bar，否则自建 #cd-bar */
export function cdApplyButtons() {
    try {
        if (typeof document === 'undefined') return;
        let host = document.getElementById('cc-var-bar');
        let own = false;
        if (!host) {
            host = document.getElementById('cd-bar');
            if (!host) {
                const send = document.getElementById('send_form');
                if (!send) return;
                own = true;
                host = document.createElement('div');
                host.id = 'cd-bar';
                host.className = 'cd-bar';
                send.appendChild(host);
            }
        }
        for (const [id, label, fn] of DEFS) {
            if (document.getElementById(id)) continue;
            const b = document.createElement('div');
            b.id = id;
            b.className = 'cd-bar-btn' + (own ? ' cd-bar-btn-own' : '');
            b.textContent = label;
            b.title = '分镜对话（cine-dialogue）';
            b.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                fn();
            });
            host.appendChild(b);
        }
    } catch (e) {
        try { console.warn('[cine-dialogue] 按钮挂载失败（不影响渲染）', e); } catch (_) { }
    }
}

/** 启动：挂一次 + 定时补挂（发送栏会被 ST 重建） */
export function cdStartButtons(deps) {
    DEPS = deps || {};
    if (typeof document === 'undefined') return;
    cdApplyButtons();
    try { setInterval(cdApplyButtons, 1500); } catch (_) { }
}
