// i18n-runtime.js — 套壳界面中英文本替换引擎（shell.html / chat.html 共用）
// 依赖：先加载 i18n.js（提供 window.SHELL_I18N_EN 精确字典 + window.SHELL_I18N_EXTRA 片段规则）
//
// 三个关键点：
// 1) 先按精确字典整串匹配，再按片段规则多轮替换 —— 拼接出来的状态文本（如 '检测失败: ' + msg）也能翻译
// 2) 记住每个文本节点的中文原文（WeakMap），中英互切可逆，且不会把英文再翻译一次
// 3) MutationObserver 监听运行时新增/改写的文本 —— 状态更新、toast、确认框弹出后自动重译
(function () {
    const EN = window.SHELL_I18N_EN || {};
    // 长片段优先，避免 '未安装' 抢先匹配 '未安装 Ollama'
    const EXTRA = (window.SHELL_I18N_EXTRA || []).slice().sort((a, b) => String(b[0]).length - String(a[0]).length);
    const textBase = new WeakMap();
    const attrBase = new WeakMap();
    const textLast = new WeakMap(); // 本引擎上一次写入的值：用来区分「应用改了文本」与「我自己写的」
    const attrLast = new WeakMap();
    const TEXT_SKIP_TAGS = ['SCRIPT', 'STYLE', 'TEXTAREA'];
    const ATTR_SKIP_TAGS = ['SCRIPT', 'STYLE'];
    const ATTRS = ['title', 'placeholder'];

    let lang = 'zh';
    let skipFn = null;
    let observer = null;
    let scheduled = false;
    let applying = false;

    function isSkipped(el, tags) {
        if (!el || el.nodeType !== 1) return false;
        if (tags.indexOf(el.tagName) !== -1) return true;
        try { return !!skipFn && !!skipFn(el); } catch (_) { return false; }
    }

    // 中文 → 英文；未命中任何规则时原样返回
    function translate(value) {
        const raw = value == null ? '' : String(value);
        const key = raw.trim();
        if (!key) return raw;
        const exact = EN[key];
        if (exact) return raw.replace(key, exact);
        let out = raw;
        for (let pass = 0; pass < 4; pass++) {
            let changed = false;
            for (let i = 0; i < EXTRA.length; i++) {
                const zh = EXTRA[i][0];
                if (out.indexOf(zh) === -1) continue;
                out = out.split(zh).join(EXTRA[i][1]);
                changed = true;
            }
            if (!changed) break;
        }
        return out;
    }

    function render(value) {
        const raw = value == null ? '' : String(value);
        return lang === 'en' ? translate(raw) : raw;
    }

    function apply() {
        scheduled = false;
        if (applying) return;
        applying = true;
        try {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);
            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                if (isSkipped(n.parentElement, TEXT_SKIP_TAGS)) continue;
                const cur = n.nodeValue == null ? '' : String(n.nodeValue);
                let origin = textBase.get(n);
                const last = textLast.get(n);
                if (origin === undefined) { textBase.set(n, cur); origin = cur; }
                else if (last === undefined ? cur !== origin : cur !== last) { textBase.set(n, cur); origin = cur; } // 应用改写了文本 → 记为新的中文原文
                const want = render(origin);
                if (cur !== want) { n.nodeValue = want; textLast.set(n, want); }
            }
            const els = document.querySelectorAll('[title],[placeholder]');
            for (let i = 0; i < els.length; i++) {
                const el = els[i];
                if (isSkipped(el, ATTR_SKIP_TAGS)) continue;
                let rec = attrBase.get(el);
                if (!rec) {
                    rec = { title: el.getAttribute('title'), placeholder: el.getAttribute('placeholder') };
                    attrBase.set(el, rec);
                }
                let lastRec = attrLast.get(el);
                if (!lastRec) { lastRec = {}; attrLast.set(el, lastRec); }
                for (let a = 0; a < ATTRS.length; a++) {
                    const attr = ATTRS[a];
                    if (rec[attr] == null) continue;
                    const curAttr = el.getAttribute(attr);
                    if (lastRec[attr] !== undefined && curAttr !== lastRec[attr]) rec[attr] = curAttr; // 应用改写了属性 → 新的原文
                    const want = render(rec[attr]);
                    if (curAttr !== want) { el.setAttribute(attr, want); lastRec[attr] = want; }
                }
            }
        } catch (_) {} finally {
            applying = false;
            try { if (observer) observer.takeRecords(); } catch (_) {} // 丢弃自己写入产生的记录
        }
    }

    function schedule() {
        if (scheduled || applying) return;
        scheduled = true;
        try { requestAnimationFrame(apply); } catch (_) { setTimeout(apply, 0); }
    }

    function onMutations(records) {
        for (let i = 0; i < records.length; i++) {
            const t = records[i].target;
            const el = t && t.nodeType === 1 ? t : (t ? t.parentElement : null);
            if (!el || !isSkipped(el, TEXT_SKIP_TAGS)) { schedule(); return; }
        }
    }

    function startObserver() {
        if (observer || !document.body) return;
        try {
            observer = new MutationObserver(onMutations);
            observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
        } catch (_) {}
    }

    function resolveLang(pref) {
        const p = String(pref || 'system');
        if (p === 'en') return 'en';
        if (p === 'zh') return 'zh';
        return String(navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    }

    function setLang(pref) {
        lang = resolveLang(pref);
        apply();
        return lang;
    }

    function init(opts) {
        const o = opts || {};
        skipFn = typeof o.skip === 'function' ? o.skip : null;
        const boot = () => { startObserver(); setLang(o.lang || 'system'); };
        if (document.body) boot();
        else document.addEventListener('DOMContentLoaded', boot);
        return lang;
    }

    window.ShellI18n = { init, setLang, apply, translate, get lang() { return lang; } };
})();
