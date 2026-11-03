// 在原版 Electron 页面内逐帧调用原版 draw；时钟可控，不抽帧、不替换动画算法。
'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { connect } = require('./cdp.cjs');
const FPS = 60, OUT = '/data/out';
const wanted = [
  ['idle', '待机', 6], ['think', '思考', 3], ['wave', '挥手', 2.5], ['happy', '开心', 2.5],
  ['sad', '难过', 2.5], ['surprise', '惊讶', 2.5], ['left', '向左走', 5], ['right', '向右走', 5],
  ['jump', '跳跃', 3], ['dance', '跳舞', 4], ['eat', '吃东西', 4], ['sleep', '入睡', 5], ['wake', '醒来', 3],
];
(async () => {
fs.mkdirSync(OUT, { recursive: true });
const meta = JSON.parse(fs.readFileSync('/original/DSH-CLIPS.json', 'utf8'));
const plan = wanted.map(([action, label, seconds]) => {
  const clip = meta.clips[action], minimum = clip.loop ? 0 : clip.times.reduce((a, b) => a + b, 0) / 1000 + .5;
  return { action, label, frames: Math.ceil(Math.max(seconds, minimum) * FPS) };
});
const totalFrames = plan.reduce((n, p) => n + p.frames, 0);
const client = await connect();
let encoder;
try {
  for (let n = 0; n < 600; n++) {
    const ready = await client.evaluate('typeof assetsReady!=="undefined"&&assetsReady&&!!flowRenderer?.ready&&typeof dshOffline!=="undefined"');
    if (ready) break;
    if (n === 599) throw Error('原版插值播放器未就绪');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await client.send('Emulation.setDeviceMetricsOverride', { width: 300, height: 360, deviceScaleFactor: 2, mobile: false });
  await client.evaluate(`(async()=>{
    __dshOffline=true;await new Promise(r=>setTimeout(r,50));
    settings={...settings,scale:1};resizeCanvas();
    lastFrameAt=0;nextFrameAt=0;lastDraw='';lastPose=null;poseKey='';transitionFrom=null;transitionAt=0;walkOffset=0;walkElapsed=null;
    globalThis.__dshRenderNow=Date.now();Date.now=()=>globalThis.__dshRenderNow;
    const list=${JSON.stringify(plan)},total=${totalFrames};
    const output=document.createElement('canvas');output.width=1280;output.height=720;
    const dc=output.getContext('2d');dc.imageSmoothingEnabled=true;dc.imageSmoothingQuality='high';
    const backgrounds=list.map((item,index)=>{
      const c=document.createElement('canvas');c.width=1280;c.height=720;const d=c.getContext('2d');
      d.fillStyle='#f3f6fb';d.fillRect(0,0,1280,720);
      d.fillStyle='#20344e';d.font='34px "Noto Sans CJK SC",sans-serif';d.fillText('大肥鱼 · 原版完整动画',52,75);
      d.fillStyle='#6a7b92';d.font='21px "Noto Sans CJK SC",sans-serif';d.fillText('原版动作、运动场插值与步态同步',54,110);
      d.fillStyle='#e6edf7';d.beginPath();d.roundRect(1117,48,111,36,18);d.fill();d.fillStyle='#60718a';d.font='17px sans-serif';d.fillText('60 FPS',1141,72);
      d.fillStyle='white';d.beginPath();d.roundRect(52,132,290,500,22);d.roundRect(370,132,858,500,22);d.fill();
      d.fillStyle='#718198';d.font='16px "Noto Sans CJK SC",sans-serif';d.fillText('动作顺序',76,176);
      list.forEach((p,i)=>{const y=193+i*32;if(i===index){d.fillStyle='#e9f0ff';d.beginPath();d.roundRect(68,y-1,258,31,9);d.fill();}d.fillStyle=i===index?'#2a5cac':'#8490a2';d.font='18px "Noto Sans CJK SC",sans-serif';d.fillText(String(i+1).padStart(2,'0')+'   '+p.label,87,y+22);});
      d.fillStyle='#244a78';d.font='32px "Noto Sans CJK SC",sans-serif';d.fillText(item.label,408,190);
      d.fillStyle='#6b7f99';d.font='19px "Noto Sans CJK SC",sans-serif';d.fillText('保持原版完整播放时序',408,227);
      d.strokeStyle='#e7edf6';d.beginPath();d.moveTo(418,606);d.lineTo(1180,606);d.stroke();
      d.fillStyle='#8290a4';d.font='15px "Noto Sans CJK SC",sans-serif';d.fillText('素材：YunYueSama / codex-deepseek-pet',54,701);d.fillText('原版渲染器逐帧输出 · 非实时录屏',943,701);
      return c;
    });
    let anchor;
    globalThis.__dshVideoFrame=async function(index,number,start,time){
      const driver=await dshOffline.step({action:list[index].action,time,started:start});
      globalThis.__dshRenderNow=driver.now;state=driver.state;walkOffset=driver.walk.offset;walkElapsed=driver.walk.elapsed;
      draw(time);
      if(index!==globalThis.__dshVideoIndex){globalThis.__dshVideoIndex=index;if(['left','right'].includes(list[index].action)){if(anchor===undefined)anchor=driver.bounds.x;}else anchor=undefined;}
      dc.drawImage(backgrounds[index],0,0);
      const shift=['left','right'].includes(list[index].action)?(driver.bounds.x-anchor):0;
      dc.drawImage(canvas,0,0,canvas.width,canvas.height,799-192+shift,250,384,384);
      dc.fillStyle='#dde6f2';dc.fillRect(54,657,1172,6);dc.fillStyle='#6d92d9';dc.fillRect(54,657,1172*(number+1)/total,6);
      return {png:output.toDataURL('image/png').split(',')[1],pose:lastPose,flowReady:flowRenderer.ready};
    };
    return {flowReady:flowRenderer.ready,nativeActions:Object.keys(PetMotion.clips).length,canvasPixels:canvas.width};
  })()`);
  encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-vcodec', 'png', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT + '/大肥鱼-原版完整动画.mp4'], { stdio: ['pipe', 'ignore', 'pipe'] });
  let error = ''; encoder.stderr.on('data', chunk => { error = (error + chunk).slice(-8000); });
  const ended = once(encoder, 'exit');
  const timeline = [], poses = [], started = Date.now();
  let frame = 0;
  for (let index = 0; index < plan.length; index++) {
    const item = plan[index], first = frame, start = frame * 1000 / FPS;
    console.log('正在逐帧渲染：' + item.label);
    timeline.push({ action: item.action, label: item.label, start: first / FPS, seconds: item.frames / FPS });
    for (let local = 0; local < item.frames; local++, frame++) {
      const value = await client.evaluate(`__dshVideoFrame(${index},${frame},${start},${frame * 1000 / FPS})`);
      if (!value.flowReady) throw Error('运动场插值失效，停止导出');
      const buffer = Buffer.from(value.png, 'base64');
      if (local === Math.min(60, item.frames - 1)) fs.writeFileSync(OUT + `/验收-${String(index + 1).padStart(2, '0')}-${item.action}.png`, buffer);
      if (local % 30 === 0) poses.push({ videoFrame: frame, action: item.action, pose: value.pose });
      if (!encoder.stdin.write(buffer)) await once(encoder.stdin, 'drain');
    }
  }
  encoder.stdin.end();
  const [code] = await ended; if (code !== 0) throw Error(error || '视频编码失败');
  const record = { renderer: 'original', fps: FPS, frames: frame, seconds: frame / FPS, width: 1280, height: 720, nativeActions: 38, originalFiles: 170, originalCommit: meta.commit, opticalFlow: true, wallSeconds: (Date.now() - started) / 1000, timeline, poses };
  fs.writeFileSync(OUT + '/原版动画制作记录.json', JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ frames: frame, seconds: frame / FPS, opticalFlow: true, wallSeconds: record.wallSeconds }));
} finally { client.close(); if (encoder && encoder.exitCode === null) encoder.kill('SIGTERM'); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
