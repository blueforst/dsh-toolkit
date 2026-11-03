// 允许服务器软件 WebGL；原版着色器、运动场、采样与渲染代码均保持原样。
(() => {
  const native = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, options) {
    return native.call(this, kind, kind.startsWith('webgl') ? { ...options, failIfMajorPerformanceCaveat: false } : options);
  };
  const stats = globalThis.__dshAnimationStats = { frames: 0, paints: 0, gpuFrames: 0, since: performance.now(), fps: 0, rafFPS: 0 };
  const image = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    if (this.canvas.id === 'pet') stats.paints++;
    return image.apply(this, args);
  };
  if (typeof WebGL2RenderingContext !== 'undefined') {
    const arrays = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) { stats.gpuFrames++; return arrays.apply(this, args); };
  }
  const raf = requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => {
    if (globalThis.__dshOffline) { globalThis.__dshNextFrame = callback; return 0; }
    return raf.call(globalThis, now => {
    if (callback.name === 'draw') {
      stats.frames++;
      stats.rafFPS = stats.frames * 1000 / Math.max(1, now - stats.since);
      stats.fps = stats.paints * 1000 / Math.max(1, now - stats.since);
    }
    callback(now);
    });
  };
})();
