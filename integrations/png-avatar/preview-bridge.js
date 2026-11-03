// 只给原版 renderer 提供状态与设置，动画仍由原版 motion/flow/app 执行。
(() => {
  const base = new URL('../../../', location.href);
  const aliases = { thinking: 'think', surprised: 'surprise', 'walk-left': 'left', 'walk-right': 'right' };
  const listeners = {};
  let signature;
  Object.defineProperty(window, '__originalDiagnostics', { get() {
    try { return { assetsReady, flowReady: !!flowRenderer?.ready, pose: lastPose, action: state.action, stats: globalThis.__dshAnimationStats }; }
    catch { return { assetsReady: false, flowReady: false }; }
  } });
  window.petApi = {
    onState: cb => { listeners.state = cb; }, onSettings: cb => { listeners.settings = cb; },
    onWalkOffset: cb => { listeners.walk = cb; }, onHitPoint() {}, onKinetics() {},
    hit() {}, interact() {}, open() {}, menu() {}, drag() {},
    ready() {
      listeners.settings?.({ scale: 1, reducedMotion: false });
      async function poll() {
        try {
          const response = await fetch(new URL('api/state', base), { cache: 'no-store' });
          if (!response.ok) throw Error('角色服务不可用');
          const value = await response.json();
          const key = JSON.stringify([value.action, value.phase, value.source, value.startedAt]);
          if (key !== signature) {
            signature = key;
            listeners.state?.({ action: aliases[value.action] || value.action, started: value.startedAt || Date.now(), until: 0, message: '' });
          }
        } catch {}
        setTimeout(poll, 200);
      }
      void poll();
    },
  };
})();
