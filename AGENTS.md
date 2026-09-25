# sillytavern-shell 项目专属规则（AGENTS.md）

> 生效 2026-09-25（v3）｜ 依据：用户 2026-09-25 两次直接下达
> ①「像这种就不出安装包了，后面不要问我了，此项目专属规则，非特殊项不需要询问我，不能动本体，但可以通过插件，仅限于此项目，只需要告诉我你做了什么，为什么这样做，优化这条规则」
> ②「ST本体，不能动，原因，后面本体更新一切改动都会报废，使用插件扩展，就不会这样，最多更新下扩展进行适配」
>
> **优先级**：系统指令 ＞ 开发者指令 ＞ 用户即时指令 ＞ 本文件 ＞ `~/.dsh/AGENTS.md`（全局）。
> 本文件与全局规则冲突时**以本文件为准**，并在汇报里写明冲突点。
> 本文件只在 `sillytavern-shell` 项目内生效，**不适用于工作区其他项目**。

---

## 零、载体边界：ST 本体不能动（本项目的根本约束）

**用户的理由（原话）**：改 ST 本体，**后面本体一更新，一切改动都会报废**；走扩展/插件则不会 —— 最坏情况也只是**跟着更新一次扩展做适配**。

### 0.1 路径台账（2026-09-25 实测，换机后需重查）

| 路径 | 是什么 | 能否改 |
|---|---|---|
| `D:\AI\SillyTavern\SillyTavern\**` | ST 1.18.0 本体：`server.js` `src/` `public/` `plugins/` `node_modules/` `package.json` `config.yaml` `UpdateAndStart.bat` …（`.git` 在，会被 `git pull` 整体刷新） | **禁止** |
| `D:\AI\SillyTavern\SillyTavern\data\**` | 本体自带的 data（同一份会被更新流程碰到） | **禁止** |
| `D:\AI\SillyTavern\Data\**` | 套壳的数据根（`Data\_storage` / `_uploads` …），ST 更新不动它 | 不主动改；只读为主 |
| `D:\AI\SillyTavern\Data\default-user\**` | **扩展与用户数据落点** = 适配层 | 可增改（扩展本体见 0.3） |
| `D:\AI\SillyTavern\Shell\**` | 套壳运行时（electron 发行版） | 不手改；要改就走套壳源码 + 发版 |
| **`sillytavern-shell` 仓库本身** | **本项目的产物**：`index.js` `shell.*` `lib/**` `scripts/**` `extensions/**` … | **可改**（这是我自己的代码，不是 ST 本体） |

**判据（一句话）**：改任何东西之前先问 —— **这个文件属于 ST 本体（被 ST 更新器刷新）吗？** 是 → 停手，改用扩展；不是（本项目源码 / 扩展目录）→ 可改。

### 0.2 禁止清单（无例外，不问也不做）

- 不改 / 不补丁 / 不替换 ST 本体任何文件（`server.js`、`src/**`、`public/**`、`plugins/**`、`node_modules/**`、`config.yaml`、启动脚本…）
- 不禁用 / 不改写 ST 的更新流程（`UpdateAndStart.bat`、`.git`、自动更新配置）
- 不在 ST 本体里加"临时适配"（哪怕只加一行）—— **会被下次更新冲掉，属于白做**
- 不删 / 不改 ST 本体自带的 `data\**`
- 不靠"改本体的 `config.yaml`"来让扩展生效；扩展必须能在**默认配置**下工作

### 0.3 适配层 = 扩展（唯一的改动通道）

- 改动一律落在 `extensions/<id>/`（card-compat / plot-pilot …），由套壳的部署逻辑 + 在线通道下发到 `Data\default-user\extensions\<id>\`
- **需要 ST 侧支持时**：用 ST 的**公开扩展 API**（`getContext()`、`eventSource`、`extension_settings` …）与**公开钩子**（如 MVU 的 `getMvuData`/`replaceMvuData`），**绝不改宿主代码**；API 不够就降级实现，不用补丁
- **ST 升级后扩展挂了** → 修扩展、发新版本（走在线通道，用户无需重装套壳）；**不得**改成去改 ST
- 结论落在汇报里：本轮若涉及 ST 侧兼容，写明"适配在扩展层完成，未触碰本体"

### 0.4 本仓库（套壳）自身的改动边界

- **可改**：`index.js` / `preload.js` / `shell.js` / `shell.html` / `shell.css` / `i18n*.js` / `webview-preload.cjs` / `prompt*` / `lib/**` / `scripts/**` / `assets/**` / `.github/workflows/**` / `vendor/**` / `tavern-scripts/**` / 文档 / `extensions/**`
- **不可删**：本体文件、`extensions/<id>/` 整目录
- **不手改**：`D:\AI\SillyTavern\Shell\**`（那是安装产物，要改就改源码后发版）

---

## 一、自主执行（默认不询问）

本项目的日常改动**直接做、不提问**：改代码、调配置、升版本（边界见第零章）。

### 1.1 发包闸门（本项目最常被问到的一条）

**只有「套壳本体」有变化才可能发包**；只改扩展时**一律不打 tag、不发版**。

判据（提交前自检）—— 只看"壳的行为"是否变了：

```
git diff --name-only <本轮起始>..HEAD |
  Select-String -Pattern '^(index\.js|preload\.js|shell\.|i18n|webview-preload|prompt|lib/|assets/|electron-builder-lite\.json|\.github/)' |
  Select-String -NotMatch '^scripts/(compat-logic|plot-pilot|toolbox|ext-|cf-).*test\.mjs$'
# 若命中里含 package.json，再看它是否只改了 version（只改版本号不算本体变更）：
git diff <本轮起始>..HEAD -- package.json | Select-String '^[+-]\s*"version"'
```

- **有命中** → 属于套壳本体变更，可以发包（**发不发仍由用户拍板**，不是自动）
- **无命中** → **不发包、不打 tag**，汇报写明「本轮只改扩展，已通过在线通道生效」

**两条明确的例外（2026-09-25 实测踩到，属误报）**

1. `package.json` **只改了 `version`** —— 这是升版本号的必要动作，不是壳行为变更
2. `scripts/*test*.mjs`（扩展夹具：`compat-logic-test` / `plot-pilot-test` / `toolbox-test` / `ext-*-test` / `cf-download-test`）—— 属于扩展的测试，随扩展变更走

理由：扩展有独立在线通道（推 `main` + `extensions/index.json` 即生效）；用户装的是套壳，重发安装包只是多一个内容相同、体量 93 MB 的产物。

### 1.2 版本号规则（沿用全局 5.1，本项目补充细节）

- 单一来源：套壳 = `package.json` 的 `version`；扩展 = `extensions/<id>/manifest.json` 的 `version`
- **扩展还有第二处必须同步**：代码里的 `const VERSION = 'x.y.z'`（`extensions/card-compat/index.js`、`extensions/plot-pilot/logic.js`）
- 三位上限：major 无上限；minor ≤ 36；patch 无上限；封顶点 `X.36.6`
- 修 bug → patch +1；加功能 → minor +1 且 patch 归零；破坏性 → major +1 且后两位归零
- 改了代码没升版本号 = 任务未完成，**不得提交**

### 1.3 每轮必做（固定收尾清单）

1. 升版本号（1.2 的三处 + 需要的 `package.json`）
2. `node scripts/ext-index.mjs` 重建清单，`--check` 必须 exit 0
3. 全量夹具：`compat-logic-test` / `ext-deploy-test` / `ext-remote-test` / `ext-manage-test` / `cf-download-test` / `plot-pilot-test` / `toolbox-test`
4. 写 `CHANGELOG.md`（项目根 + 对应的 `extensions/<id>/CHANGELOG.md`）
5. commit（消息用 `-F` 文件，见全局 5.2）→ push `main`
6. 核对线上清单：`extensions/index.json` 是否已是新版本（Contents API 口径）
7. 只改扩展时：把新文件**同步到已装目录** `Data\default-user\extensions\<id>\` 并逐文件核对 SHA1，然后报告

---

## 二、必须询问用户的「特殊项」（白名单，封闭列举）

**只有下列情况才提问**；不在这张表里的，一律自己决定并继续：

| # | 特殊项 | 为什么必须问 |
|---|---|---|
| 1 | **发包 / 打 tag / 创建 Release** | 用户要拍板（默认不出，见 1.1） |
| 2 | **改 ST 本体**（任何形式的补丁、替换、禁用更新流程） | **本项目根本禁令**（第零章）；确需时只能由用户决定 |
| 3 | **删除或覆盖非本会话产物**（工作区外文件、别人的扩展、系统配置） | 不可逆，属工作区外 |
| 4 | **结构性改套壳本体**：删套壳文件、换构建器/发布配置、依赖大版本升级 | 影响范围不可准确判断 |
| 5 | **网络/代理/hosts/DNS/防火墙/证书校验开关** | 影响面超出本项目 |
| 6 | **单次操作预计超阈值**：>100k token、>30 分钟、>1 GB 磁盘、>10,000 文件、下载 >500 MB | 消耗用户资源 |
| 7 | 需求本身有歧义，或有多种合理解释且取舍取决于用户偏好 | 无法替他决定 |

**自查句**：想提问之前先确认它是不是上表 1~7 之一 —— **不是就别问**。

---

## 三、汇报格式（本项目精简版）

每轮必须给出两段（用户明确要的）：

1. **做了什么** —— 具体动作 + 文件/路径，可核查
2. **为什么这样做** —— 判断依据（实测数据优先）

第三段 **「结果」**（夹具数、版本号、提交号、线上清单）**照常给**，用数据不用形容词。
涉及 ST 侧兼容时，明确写一句「适配在扩展层完成，未触碰 ST 本体」。

**只有**命中第二章特殊项时，才追加第四段：`未决（需你决定）` + 选项 + 每项代价 + 我的建议。

---

## 四、本文件自身的优化机制

### 4.1 每轮自检（四条，答"否"即在汇报里说明）

- 本轮**有没有**向用户提过问题？提的是不是第二章 1~7？
- 本轮**有没有**碰 ST 本体（`SillyTavern\**` 任何写入）？
- 本轮**有没有**动套壳本体（删文件 / 换结构 / 删扩展目录）？
- 本轮**有没有**在只改扩展的情况下打 tag / 发包？

### 4.2 违规处置

发现本轮问了非特殊项、碰了 ST 本体、或该不发包却发了包：**下一轮内**二选一 —— ① 改回原状；② 升级进第二章（连同理由）。不许放着不管。

### 4.3 修订规则

- 修改本文件：追加/重排均可，但必须同步更新文件头的生效日期
- 每次修订在末尾「修订记录」加一行：日期 / 改了什么 / 为什么
- 修订本文件**不算代码变更**，不升版本号，但必须在 `CHANGELOG.md` 记一条

---

## 修订记录

| 日期 | 改动 | 原因 |
|---|---|---|
| 2026-09-25 | 建立本文件 v1：自主执行边界、发包闸门、特殊项白名单（6 条）、汇报精简、自检与修订机制 | 用户下达「此项目专属规则，非特殊项不需要询问我，不能动本体，但可以通过插件…优化这条规则」 |
| 2026-09-25 | **v2**：把"本体"明确为 **ST 本体**并提到第零章；新增路径台账（0.1）、ST 禁止清单（0.2）、适配层=扩展（0.3）、套壳自身边界（0.4）；特殊项白名单加"改 ST 本体"；自检由三问改四问 | 用户补充「ST本体，不能动，原因，后面本体更新一切改动都会报废，使用插件扩展，就不会这样，最多更新下扩展进行适配」 |
| 2026-09-25 | **v3**：发包闸门判据修正 —— 排除「`package.json` 只改 version」与「`scripts/*test*.mjs` 扩展夹具」两类误报，并给出只看壳行为的组合命令 | 0.16.2 提交自检把这两类误判为"壳行为变更"（本应不发包） |
