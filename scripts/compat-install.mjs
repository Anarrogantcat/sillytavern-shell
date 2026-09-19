// scripts/compat-install.mjs — 兼容旧用法：只同步 card-compat
// 真正的实现在 scripts/ext-install.mjs（通用安装器），本文件只是薄封装。
// 用法：node scripts/compat-install.mjs [dataRoot] [--dry-run]
import { syncExtension, DEFAULT_DATA_ROOT } from './ext-install.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dataRoot = args.find((a) => !a.startsWith('--')) || DEFAULT_DATA_ROOT;

const r = syncExtension('card-compat', { dataRoot, dryRun });
if (!r.manifest) process.exit(2);
