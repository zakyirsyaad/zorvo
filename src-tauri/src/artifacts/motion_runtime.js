// Zorvo's motion runtime. It runs before a motion page's own scripts, in the preview's frames and
// in the hidden view that renders it, and gives the page one clock: Zorvo's. Every CSS and Web
// Animation is paused and seeked to the time Zorvo asks for; JavaScript motion registers with
// `zorvoMotion.onSeek`. Pinned by `motion_runtime_is_pinned`: a change here is a visible one.
(() => {
  const path = location.pathname;
  if (!/^\/motion\/[^/]+\/[^/]+\/f\//.test(path)) return;
  const query = new URLSearchParams(location.search);
  const number = (name, fallback) => {
    const value = Number(query.get(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const format = /^[a-z0-9-]{1,64}$/.test(query.get('format') || '') ? query.get('format') : 'default';
  const width = number('w', innerWidth);
  const height = number('h', innerHeight);
  const duration = number('d', 1);
  const fps = number('fps', 60);
  const handlers = [];
  let now = 0;

  const markFormat = () => {
    if (document.documentElement) document.documentElement.dataset.format = format;
  };

  const seek = (seconds) => {
    const t = Math.min(Math.max(Number(seconds) || 0, 0), duration);
    now = t;
    for (const animation of document.getAnimations()) {
      try {
        animation.pause();
        animation.currentTime = t * 1000;
      } catch (_) {
        // An animation that cannot be seeked stays where it is.
      }
    }
    for (const handler of handlers) {
      try {
        handler(t);
      } catch (_) {
        // One handler's error does not stop the others.
      }
    }
    return true;
  };

  const ready = () => {
    const images = Array.from(document.images || []);
    return JSON.stringify({
      fonts: document.fonts ? document.fonts.status === 'loaded' : true,
      images: images.every((image) => image.complete),
      loaded: document.readyState === 'complete',
      animations: document.getAnimations().length,
      handlers: handlers.length,
    });
  };

  const api = Object.freeze({
    format,
    width,
    height,
    duration,
    fps,
    onSeek(handler) {
      if (typeof handler === 'function') {
        handlers.push(handler);
        try {
          handler(now);
        } catch (_) {
          // As in `seek`.
        }
      }
    },
  });
  const define = (name, value) =>
    Object.defineProperty(window, name, { value, writable: false, configurable: false });
  define('zorvoMotion', api);
  define('__zorvoMotionSeek', seek);
  define('__zorvoMotionReady', ready);

  markFormat();
  document.addEventListener('DOMContentLoaded', () => {
    markFormat();
    seek(now);
  });
  addEventListener('load', () => seek(now));
  // The preview's wrapper drives the clock from the parent frame.
  addEventListener('message', (event) => {
    const data = event.data;
    if (window.parent === window || event.source !== window.parent) return;
    if (data && data.zorvo === 'motion-seek') seek(data.t);
  });
})();
