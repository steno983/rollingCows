import { createLoop } from './core/loop';
import { createScene, type SceneContext } from './render/scene';

function ensureCanvas(): HTMLCanvasElement {
  const existing = document.querySelector<HTMLCanvasElement>('canvas#game');
  const canvas = existing ?? document.createElement('canvas');
  canvas.id = 'game';
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;';
  if (existing === null) document.body.appendChild(canvas);
  return canvas;
}

function showFatal(message: string): void {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'font:16px/1.5 system-ui,sans-serif;color:#123;background:#e8f4ff;text-align:center;padding:24px;';
  box.textContent = message;
  document.body.appendChild(box);
}

function main(): void {
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.background = '#e8f4ff';
  const canvas = ensureCanvas();

  let view: SceneContext;
  try {
    view = createScene(canvas);
  } catch {
    showFatal('WebGL non è disponibile su questo browser: Rolling Cows non può partire.');
    return;
  }

  const loop = createLoop({
    update(dt: number): void {
      view.update(dt, 1, false);
    },
    render(): void {
      view.render();
    },
  });

  window.addEventListener('resize', () => view.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loop.stop();
    else loop.start();
  });

  loop.start();
}

main();
