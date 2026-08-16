import './style.css';
import { createEventBus } from './core/events';
import { createLoop } from './core/loop';
import { createStateMachine } from './core/state-machine';
import { CONFIG } from './game/config';
import { createGame, handleAction, startRun, updateGame } from './game/game';
import { entityCenterX } from './game/lanes';
import { loadRecord } from './game/score';
import { createInput } from './input/input';
import { worldToViewX } from './render/camera-rig';
import { avalancheTrail, burstFromModel, resetDebris } from './render/debris';
import { createEntitiesView } from './render/entities-view';
import { MODELS } from './render/models';
import { createPlayerView } from './render/player-view';
import { createScene, type SceneContext } from './render/scene';
import { createTerrain } from './render/terrain';
import { createVoxelPool } from './render/voxel-pool';
import { createHud } from './ui/hud';
import { createScreens } from './ui/screens';

/**
 * Il canvas e il contenitore UI vivono già in index.html (`#game-canvas` e
 * `#ui-root`): qui li recuperiamo soltanto, non li creiamo mai. Crearne uno
 * nuovo lascerebbe un canvas morto nel markup e la UI fuori dallo z-order
 * corretto (difetto rilevato nella review del task 14).
 */
function getCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById('game-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas #game-canvas non trovato in index.html');
  }
  return canvas;
}

function getUiRoot(): HTMLElement {
  const root = document.getElementById('ui-root');
  if (root === null) {
    throw new Error('Contenitore #ui-root non trovato in index.html');
  }
  return root;
}

function showFatal(message: string): void {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'font:16px/1.5 system-ui,sans-serif;color:#123;background:#e8f4ff;text-align:center;padding:24px;z-index:9;';
  box.textContent = message;
  document.body.appendChild(box);
}

function main(): void {
  const canvas = getCanvas();
  const uiRoot = getUiRoot();

  let view: SceneContext;
  try {
    view = createScene(canvas);
  } catch {
    showFatal('WebGL non è disponibile su questo browser: Rolling Cows non può partire.');
    return;
  }

  const terrain = createTerrain();
  const entitiesView = createEntitiesView();
  const playerView = createPlayerView();
  const pool = createVoxelPool(CONFIG.render.voxelPoolSize, CONFIG.render.voxelSize);
  view.scene.add(terrain.group);
  view.scene.add(entitiesView.group);
  view.scene.add(playerView.group);
  view.scene.add(pool.mesh);

  const input = createInput(canvas);
  const hud = createHud(uiRoot);
  const screens = createScreens(uiRoot);
  const machine = createStateMachine();

  const bus = createEventBus();
  const game = createGame(Date.now(), bus);

  let record = loadRecord();

  function goToMenu(): void {
    if (machine.transition('menu')) {
      screens.setMenuRecord(record);
      screens.show('menu');
    }
  }

  function beginRun(): void {
    if (!machine.transition('playing')) return;
    startRun(game, Date.now());
    pool.reset();
    resetDebris();
    screens.show('playing');
  }

  function togglePause(): void {
    if (machine.current === 'playing' && machine.transition('paused')) {
      screens.show('paused');
      return;
    }
    if (machine.current === 'paused' && machine.transition('playing')) {
      screens.show('playing');
    }
  }

  screens.onStart(beginRun);
  screens.onRestart(beginRun);
  screens.onResume(togglePause);
  screens.onMenu(goToMenu);
  screens.onToggleMute(() => {
    // L'audio arriva in un task successivo: qui il toggle esiste già e non fa nulla.
  });

  bus.on('obstacle:hit', (payload) => {
    const width = payload.kind === 'cabin' ? 2 : 1;
    const hitX = worldToViewX(entityCenterX(payload.lane, width));
    const cowX = worldToViewX(game.player.x);

    if (payload.outcome === 'smashed') {
      burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, 9);
      view.shake(0.28);
      return;
    }
    if (payload.outcome === 'forgiven') {
      burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, 6);
      view.shake(0.45);
      return;
    }
    // morte: la mucca si disintegra e l'ostacolo con lei
    burstFromModel(pool, MODELS.cow, cowX, 0.6, 0, 16);
    burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, 10);
    view.shake(0.7);
  });

  bus.on('pickup:collected', (payload) => {
    burstFromModel(pool, MODELS[payload.kind], worldToViewX(game.player.x), 0.8, 0, 4);
  });

  bus.on('avalanche:triggered', () => {
    view.shake(0.6);
  });

  bus.on('run:ended', (payload) => {
    record = Math.max(record, payload.points);
    if (machine.transition('gameover')) {
      screens.setGameOver(payload.points, record, payload.isRecord);
      screens.show('gameover');
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && machine.current === 'playing') {
      machine.transition('paused');
      screens.show('paused');
    }
    if (document.hidden) loop.stop();
    else loop.start();
  });

  window.addEventListener('blur', () => {
    if (machine.current === 'playing') {
      machine.transition('paused');
      screens.show('paused');
    }
  });

  function syncHud(): void {
    hud.setPoints(game.score.points);
    hud.setCharge(game.avalanche.charge / CONFIG.avalanche.threshold);
    hud.setSize(game.avalanche.size);
    hud.setAvalanche(game.avalanche.phase !== 'idle', game.avalanche.phase === 'warning');
  }

  const loop = createLoop({
    update(dt: number): void {
      // PAUSE va letto in qualunque stato, altrimenti da fermi Esc non riprende.
      const action = input.consume();
      if (action === 'PAUSE') {
        togglePause();
      } else if (action !== null && machine.current === 'playing') {
        handleAction(game, action);
      }

      const playing = machine.current === 'playing';
      if (playing) {
        updateGame(game, dt);
        syncHud();
      }

      const avalancheOn = playing && game.avalanche.phase !== 'idle';
      const intensity = avalancheOn ? game.avalanche.size / CONFIG.avalanche.maxSize : 0;
      avalancheTrail(pool, dt, worldToViewX(game.player.x), 0.2, -1.5, intensity);
      pool.update(dt, game.world.speed);

      // La vista continua a vivere anche in menu, pausa e game over: il pendio
      // e la mucca restano visibili dietro le schermate, ma non avanzano.
      terrain.sync(game.world);
      entitiesView.sync(game.entities);
      playerView.sync(game.player, game.avalanche.size, game.world.speed, playing ? dt : 0);
      view.update(dt, game.avalanche.size, avalancheOn);
    },
    render(): void {
      view.render();
    },
  });

  window.addEventListener('resize', () => view.resize());

  goToMenu();
  syncHud();
  loop.start();
}

main();
