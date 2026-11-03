// Linux 宿主适配：直接启动原项目完整主程序；不改动画、行为、物理和渲染模块。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { isIP } = require('node:net');
const { app } = require('electron');
const root = '/original';
const config = JSON.parse(fs.readFileSync('/data/config.json', 'utf8'));
const token = fs.readFileSync(config.tokenFile, 'utf8').trim();
const origin = new URL(config.url);
if (origin.protocol !== 'http:' || isIP(origin.hostname) !== 4 || origin.username || origin.password || origin.pathname !== '/' || !/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin.hostname) || token.length < 32) throw Error('原版桌宠需要私网角色服务与独立凭据');
if (process.env.AVATAR_RENDER_MODE === '1') {
  global.__dshClock = { epoch: Date.now(), now: Date.now() };
  Date.now = () => global.__dshClock.now;
}
fs.mkdirSync('/data/electron', { recursive: true });
app.setPath('userData', '/data/electron');
app.commandLine.appendSwitch('disable-dev-shm-usage');
const settingsFile = '/data/electron/settings.json';
if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, JSON.stringify({
  ...require(root + '/src/main/settings.cjs').DEFAULT_SETTINGS,
  scale: (config.size || 240) / 300, clickThrough: true,
  environment: false, windowEdges: false, quietFullscreen: false,
  vision: false, autoVision: false, startAtLogin: false,
}));

const file = root + '/src/main/main.cjs';
let source = fs.readFileSync(file, 'utf8');
const needle = "path.join(root, 'src/renderer/index.html')";
if (source.split(needle).length !== 2) throw Error('上游入口变化，需要重新审查 Linux 适配');
source = source.replace(needle, "path.join(root, 'src/renderer/dsh-index.html')");
source = source.replace('sandbox: true, devTools:', 'sandbox: true, backgroundThrottling: false, devTools:');
if (process.env.AVATAR_RENDER_MODE === '1') {
  const preload = fs.readFileSync(root + '/src/preload.cjs', 'utf8');
  fs.writeFileSync('/data/offline-preload.cjs', preload + "\ncontextBridge.exposeInMainWorld('dshOffline',{step:value=>ipcRenderer.invoke('dsh:offline',value)});\n");
  source = source.replace("preload: path.join(root, 'src/preload.cjs')", "preload: '/data/offline-preload.cjs'");
}
source += `
// 仅增加 DSH 的状态入口；沿用上方原版行为仲裁器、步态与窗口调度。
let dshOwned=false,dshSignature='';
module.exports.dsh={
 renderer:()=>pet?.webContents,
 snapshot:()=>({action:brain.action,started:brain.started,bounds:pet?.getBounds(),clickThrough:settings?.clickThrough,scale:settings?.scale,nativeWindowId:pet?.getNativeWindowHandle().readUInt32LE(0),focused:pet?.isFocused()}),
 apply(value){
  if(!pet||!settings)return;
  const active=value.source==='manual'||(value.source==='auto'&&value.phase!=='idle');
  const key=JSON.stringify([value.action,value.phase,value.source,value.sessionId,value.startedAt]);
  if(key===dshSignature)return;dshSignature=key;
  if(!active){if(dshOwned){const walking=['left','right'].includes(brain.action);stopWalk(true);brain.chatBusy=false;if(!walking){brain.until=0;brain.play('idle','',0,0);}}dshOwned=false;return;}
  dshOwned=true;const aliases={thinking:'think',surprised:'surprise','walk-left':'left','walk-right':'right'};
  const action=aliases[value.action]||value.action;
  if(!require('./behavior.cjs').ACTIONS[action])return;
  stopWalk();brain.chatBusy=true;brain.until=0;brain.play(action,'',60000,100);
  if(action==='left'||action==='right'){
   const b=pet.getBounds(),area=screen.getDisplayMatching(b).workArea;
   target=action==='left'?area.x:area.x+area.width-b.width;lastWalkDirection=action;nextWalk=Date.now();
  }
 }
};
if(process.env.AVATAR_RENDER_MODE==='1')ipcMain.handle('dsh:offline',(_event,value)=>{
 if(!Number.isFinite(value.time)||value.time<0)throw Error('离线时间无效');
 global.__dshClock.now=global.__dshClock.epoch+value.time;
 module.exports.dsh.apply({action:value.action,phase:'manual',source:'manual',startedAt:global.__dshClock.epoch+value.started});
 tick();
 const b=pet.getBounds();
 return {now:Date.now(),state:brain.snapshot(),bounds:b,walk:{offset:target===null?0:Math.sign(target-b.x)*walkRemainder,elapsed:walkTravel?walkTravel/(55*Math.max(.01,settings.scale))*1000:null}};
});
`;
const host = new Module(file, module);
host.filename = file;
host.paths = Module._nodeModulePaths(path.dirname(file));
host._compile(source, file);
let stopped = false, lastSuccess = Date.now();
async function poll() {
  while (!stopped) {
    try {
      if (process.env.AVATAR_TEST_FILE) host.exports.dsh.apply(JSON.parse(fs.readFileSync(process.env.AVATAR_TEST_FILE, 'utf8')));
      else {
        const response = await fetch(new URL('/api/state', origin), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) });
        if (!response.ok) throw Error('角色服务暂不可用');
        host.exports.dsh.apply(await response.json());
      }
      lastSuccess = Date.now();
    } catch { if (Date.now() - lastSuccess > 5000) host.exports.dsh.apply({ action: 'idle', phase: 'idle', source: 'default' }); }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}
if (process.env.AVATAR_RENDER_MODE !== '1') void app.whenReady().then(() => poll());
const monitor = setInterval(async () => {
  const web = host.exports.dsh.renderer();
  if (!web || web.isDestroyed()) return;
  try {
    const rendered = await web.executeJavaScript(`({assetsReady, flowReady:!!flowRenderer?.ready, action:state.action,
      pose:lastPose, size:canvas.width, stats:globalThis.__dshAnimationStats,
      backend:flowRenderer?.ready?flowRenderer.gl.getParameter(flowRenderer.gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL||flowRenderer.gl.RENDERER):null})`);
    if (rendered.assetsReady && !rendered.flowReady) throw Error('原版运动场插值未启用，拒绝退化播放');
    const value = { ...host.exports.dsh.snapshot(), ...rendered, updatedAt: Date.now(), targetFPS: 60, originalCommit: '7661c8b304c5400701f91da01b1a643a207331de' };
    fs.writeFileSync('/data/status.tmp', JSON.stringify(value)); fs.renameSync('/data/status.tmp', '/data/status.json');
  } catch (error) {
    if (/拒绝退化/.test(error.message)) { console.error(error.message); app.exit(2); }
  }
}, 1000);
app.on('before-quit', () => { stopped = true; clearInterval(monitor); });
process.on('SIGTERM', () => app.quit());
