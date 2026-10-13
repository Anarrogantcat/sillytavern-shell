# ST 本体补丁集（patches/）

> **为什么会有这个目录**：`AGENTS.md` §0.5 登记了 `cine-dialogue` 的例外 —— **允许改 ST 本体**。
> 但 ST 本体是 git 仓库（`D:\AI\SillyTavern\SillyTavern\.git`），**每次更新都会 `git pull` 整体刷新**，
> 手改的代码 100% 会被冲掉。所以「改本体」必须配一条**可重放**的路径 —— 就是这个目录。
>
> **「毁了重新适配」= 一条命令**：
>
> ```powershell
> node scripts/st-patch.mjs --apply
> ```

## 用法

```powershell
node scripts/st-patch.mjs                 # 只报状态（默认）
node scripts/st-patch.mjs --apply         # 应用还没应用的
node scripts/st-patch.mjs --revert        # 回滚已应用的
node scripts/st-patch.mjs --st "D:/别的路径/SillyTavern"   # 指定 ST 本体
```

**判定方式**：每个补丁插入的段落带唯一标记 `BEGIN sillytavern-shell patch #NNN`，
`st-patch.mjs` 直接搜目标文件里有没有这个标记 —— 不依赖 git 状态，重复跑也安全。

## 现有补丁

| # | 文件 | 目标 | 干什么 | 为什么必须动本体 |
|---|---|---|---|---|
| **001** | `001-messageFormatting-hook.patch` | `public/script.js` | 在 `messageFormatting()` 开头插入一个受保护的扩展钩子 `window.CineDialogueFormat` | `messageFormatting` 是 ST **唯一的渲染漏斗**（新消息 / 流式 / 编辑 / swipe / 重渲染全走它）。扩展层**无法**在它之前插入预处理：<br>① 它是 ES module 的 export，外部**不能重新赋值**；<br>② 事后改 DOM 拿不到「markdown/showdown/DOMPurify 之前」的时机 —— 流式期间 `名字·层 ` 标签会**裸奔可见**（一次 6000t 生成要几分钟） |

## 挂钩点的锚（ST 更新后手改时按这个找）

`public/script.js` → `messageFormatting` 函数开头：

```js
export function messageFormatting(mes, ch_name, isSystem, isUser, messageId, sanitizerOverrides = {}, isReasoning = false) {
    if (!mes) {
        return '';
    }
                            // ← 补丁插在这里
    if (Number(messageId) === 0 && !isSystem && !isUser && !isReasoning) {
```

## 写新补丁的规矩

1. **最小**：只插入，不重构 ST 既有代码（这样冲突最容易合）
2. **带标记**：插入段必须含 `BEGIN/END sillytavern-shell patch #NNN`，`st-patch.mjs` 靠它判状态
3. **受保护**：必须能「没装扩展时零开销」—— 典型写法是 `typeof window.X === 'function'` 守卫 + `try/catch`
4. **可逆**：写完必须 `--apply` → `--revert` → 再 `--apply` 跑一遍（`git apply -R` 不报错）
5. **只 diff 目标文件**：产出命令
   ```powershell
   git -C "D:/AI/SillyTavern/SillyTavern" diff -- public/script.js | Out-File patches/00N-xxx.patch -Encoding utf8
   ```
   ⚠️ **别用不带 `--` 的全局 `git diff`** —— 用户本体里可能本来就有其它改动（如 `default/config.yaml`、`public/index.html`），别把别人的改动卷进我们的补丁
6. **每次都记进 `CHANGELOG.md`**：改了本体哪些文件、为什么必须动、ST 更新后怎么重新适配

## 回退

```powershell
node scripts/st-patch.mjs --revert
```

回滚后 ST 恢复原状；扩展仍可工作（钩子不存在时它走 DOM 后处理那条路）。
