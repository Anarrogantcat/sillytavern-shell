
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const mockPreload = path.join(__dirname, '.mock-preload.cjs');
fs.writeFileSync(mockPreload, 'const { contextBridge } = require("electron"); contextBridge.exposeInMainWorld("electronAPI", {});');
const html = path.join(root, 'shell.html');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
let done = false;
const results = [];
function finish(code) { if (!done) { done = true; try { fs.rmSync(mockPreload, { force: true }); } catch (_) {} try { app.exit(code); } catch (_) { process.exit(code); } } }
setTimeout(() => { console.log('ui-snapshot TIMEOUT'); finish(3); }, 30000);
function check(label, cond) { results.push({ label, pass: !!cond }); }
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1000, height: 800, show: false, webPreferences: { preload: mockPreload, webviewTag: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(html);
  await new Promise(r => setTimeout(r, 700));
  await win.webContents.executeJavaScript('document.getElementById("loading-overlay").style.display="none"; document.getElementById("sillytavern-webview").style.display="none"; document.getElementById("settings-overlay").style.display=""; document.getElementById("settings-overlay").classList.remove("hidden"); true');
  await new Promise(r => setTimeout(r, 500));
  const s = await win.webContents.executeJavaScript('(() => { const panel = document.querySelector(".settings-panel"); const rows = [...document.querySelectorAll(".settings-content .setting-row")].filter(r => r.getBoundingClientRect().width > 0); const simpleRows = rows.filter(r => !r.querySelector(".setting-hint")); const hintRows = rows.filter(r => r.querySelector(".setting-hint")); const simpleHeights = simpleRows.map(r => Math.round(r.getBoundingClientRect().height)); const hintHeights = hintRows.map(r => Math.round(r.getBoundingClientRect().height)); const labels = rows.map(r => Math.round((r.querySelector(":scope > label:not(.tool-switch)")||{getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width)); const pr = panel && panel.getBoundingClientRect(); const tb = document.querySelector("#tools-panel .toolbox-toolbar"); const body = document.querySelector("#tools-panel .bench-body"); return { panelW: pr?Math.round(pr.width):0, panelH: pr?Math.round(pr.height):0, simpleHeights, hintHeights, labelWidths: labels, toolbarPos: tb?getComputedStyle(tb).position:null, bodyScrollH: body?body.scrollHeight:0, bodyClientH: body?body.clientHeight:0 }; })()');
  check('panel width=720', s.panelW === 720);
  check('panel height fixed (>480)', s.panelH > 480);
  check('simple rows all 40px', s.simpleHeights.length > 0 && s.simpleHeights.every(h => h === 40));
  check('hint rows >=40', (s.hintHeights || []).every(h => h >= 40));
  check('labels width 140', s.labelWidths.every(w => w === 140));
  await win.webContents.executeJavaScript('document.getElementById("settings-overlay").style.display="none"; document.getElementById("tools-panel").classList.remove("hidden"); true');
  await new Promise(r => setTimeout(r, 500));
  const t = await win.webContents.executeJavaScript('(() => { const tb=document.querySelector("#tools-panel .toolbox-toolbar"); const body=document.querySelector("#tools-panel .bench-body"); return { toolbarPos: tb?getComputedStyle(tb).position:null, bodyScrollH: body?body.scrollHeight:0, bodyClientH: body?body.clientHeight:0 }; })()');
  check('toolbar sticky', t.toolbarPos === 'sticky');
  check('tool list scrollable', t.bodyScrollH > t.bodyClientH);
  console.log(JSON.stringify({ checks: results }, null, 2));
  const failed = results.filter(r => !r.pass).length;
  finish(failed ? 2 : 0);
}).catch(e => { console.error(e); finish(4); });
