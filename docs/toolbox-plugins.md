# 工具箱插件（shell-tools）

套壳支持用声明式 JSON 扩展工具箱，不需要改套壳代码。

## 目录

工具箱 → 「🧩 插件工具」→ 「打开插件目录」可直接打开，**以该按钮显示的路径为准**：

- 开发版：`%APPDATA%\sillytavern-electron\shell-tools\`
- 安装版：`%APPDATA%\SillyTavern\shell-tools\`（随安装版产品名变化）

首次启动会自动创建该目录并写入 `README.md`。

## 文件格式

```json
{
  "group": "我的工具",
  "tools": [
    { "label": "打开项目目录", "type": "openPath", "path": "D:\\AI\\sillytavern-shell" },
    { "label": "SillyTavern 文档", "type": "url", "url": "https://docs.sillytavern.app/" },
    { "label": "列出文件", "type": "command", "command": "dir", "cwd": "D:\\AI" },
    { "label": "复制口令", "type": "copy", "text": "hello" },
    { "label": "说明", "type": "info", "text": "这是一条说明" }
  ]
}
```

- 根对象也可以是数组（直接一组 tools）
- 一个目录可放多个 `.json`，每个文件一个分组
- 修改后重新打开工具箱即可生效（无需重启）

## 类型

| type | 说明 | 必填 |
|---|---|---|
| command | 执行命令并显示输出 | command、可选 cwd |
| url | 默认浏览器打开（仅 http/https） | url |
| openPath | 资源管理器打开文件/目录 | path |
| copy | 复制文本 | text |
| info | 显示文本 | text |

## 限制与安全

- 单命令 60 秒超时，输出上限 1MB
- 命令由你自己编写，请勿放入不可信内容
- 只读取该目录下的 `.json` 文件
