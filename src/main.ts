import './style.css';
import { createAudio } from './audio/audio';
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
import { createPerfMonitor } from './render/perf-monitor';
import { createPlayerView } from './render/player-view';
import { createScene } from './render/scene';
import { createTerrain } from './render/terrain';
import { createVoxelPool } from './render/voxel-pool';
import { isWebGLAvailable, showWebGLError } from './render/webgl-support';
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

function main(): void {
  const canvas = getCanvas();
  const uiRoot = getUiRoot();

  // Rilevamento esplicito invece del try/catch attorno a createScene: un
  // messaggio pulito e selezionabile al posto dello schermo nero, prima
  // ancora di provare ad allocare renderer o scena.
  if (!isWebGLAvailable()) {
    showWebGLError(uiRoot);
    return;
  }

  const view = createScene(canvas);

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
  const perf = createPerfMonitor();

  const bus = createEventBus();
  const game = createGame(Date.now(), bus);

  const audio = createAudio();
  audio.attach(bus);

  /**
   * Sblocco dell'audio al primo gesto reale dell'utente: è l'unico momento in cui
   * iOS/Safari accetta il resume dell'AudioContext. I listener si tolgono da soli.
   */
  const unlockAudio = (): void => {
    audio.unlock();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('touchend', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('touchend', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  let record = loadRecord();
  /** Scala applicata a burst e scia quando il monitor perf chiede il degrado. */
  let particleScale = 1;
  let statsTimer = 0;

  /** Rallentatore alla morte: si continua a renderizzare, poi arriva il game over. */
  let dyingSeconds = 0;
  let pendingGameOver: { points: number; distance: number; isRecord: boolean } | null = null;

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
    dyingSeconds = 0;
    pendingGameOver = null;
    playerView.group.visible = true;
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

  function showGameOver(): void {
    const payload = pendingGameOver;
    pendingGameOver = null;
    if (payload === null || !machine.transition('gameover')) return;
    screens.setGameOver(payload.points, record, payload.isRecord);
    screens.show('gameover');
  }

  screens.onStart(beginRun);
  screens.onRestart(beginRun);
  screens.onResume(togglePause);
  screens.onMenu(goToMenu);
  screens.onToggleMute((isMuted) => {
    audio.setMuted(isMuted);
  });

  bus.on('obstacle:hit', (payload) => {
    const width = payload.kind === 'cabin' ? 2 : 1;
    const hitX = worldToViewX(entityCenterX(payload.lane, width));

    if (payload.outcome === 'smashed') {
      burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, CONFIG.feel.smashBurstPower * particleScale);
      view.shake(CONFIG.feel.impactShake);
      return;
    }
    if (payload.outcome === 'forgiven') {
      burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, CONFIG.feel.smashBurstPower * particleScale);
      view.shake(CONFIG.feel.impactShake);
      return;
    }
    // morte: l'ostacolo si disintegra subito, la mucca segue al via del rallentatore.
    burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, CONFIG.feel.deathBurstPower * particleScale);
    view.shake(CONFIG.feel.impactShake);
  });

  bus.on('pickup:collected', (payload) => {
    burstFromModel(pool, MODELS[payload.kind], worldToViewX(game.player.x), 0.8, 0, 4 * particleScale);
  });

  bus.on('avalanche:triggered', () => {
    view.shake(CONFIG.feel.avalancheShake);
  });

  bus.on('run:ended', (payload) => {
    record = Math.max(record, payload.points);
    pendingGameOver = payload;
    dyingSeconds = CONFIG.feel.deathSlowSeconds;
    view.shake(CONFIG.feel.deathShake);
    burstFromModel(
      pool,
      MODELS.cow,
      worldToViewX(game.player.x),
      0.6,
      0,
      CONFIG.feel.deathBurstPower * particleScale,
    );
    playerView.group.visible = false;
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

  /** Logga draw call e triangoli ogni CONFIG.perf.statsLogSeconds: aiuta a
   *  scovare a occhio un tipo di entità sfuggito all'istanziazione. */
  function logStats(dt: number): void {
    statsTimer += dt;
    if (statsTimer < CONFIG.perf.statsLogSeconds) return;
    statsTimer = 0;
    const info = view.renderer.info.render;
    console.info(`[perf] draw call: ${info.calls} | triangoli: ${info.triangles} | budget: <60 / <150000`);
  }

  /**
   * Il loop interno gira a step fisso (vedi core/loop.ts): dt qui è sempre lo
   * stesso valore, quindi non basta per misurare il framerate reale dello
   * schermo. Il tempo vero fra due frame renderizzati si misura a parte, in
   * render(), con performance.now().
   */
  let lastFrameMs: number | null = null;
  function samplePerf(): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (lastFrameMs !== null) {
      const realDt = (now - lastFrameMs) / 1000;
      if (perf.sample(realDt) && particleScale === 1) {
        particleScale = CONFIG.perf.lowQualityParticleScale;
        view.setQuality(true);
        console.info('[perf] frame rate basso: qualità ridotta (ombre off, meno particelle)');
      }
    }
    lastFrameMs = now;
  }

  const loop = createLoop({
    update(dt: number): void {
      // PAUSE va letto in qualunque stato, altrimenti da fermi Esc non riprende.
      const action = input.consume();
      if (action === 'PAUSE') {
        togglePause();
      } else if (action !== null && machine.current === 'playing' && dyingSeconds <= 0) {
        handleAction(game, action);
      }

      // Rallentatore alla morte: la logica di gioco resta ferma (game.alive è
      // già false), ma detriti e camera continuano ad animarsi al rallenty
      // finché non scade dyingSeconds, poi si passa al game over.
      if (dyingSeconds > 0) {
        dyingSeconds -= dt;
        const slowDt = dt * CONFIG.feel.deathTimeScale;
        pool.update(slowDt, game.world.speed * CONFIG.feel.deathTimeScale);
        view.update(slowDt, game.avalanche.size, false);
        logStats(dt);
        if (dyingSeconds <= 0) showGameOver();
        return;
      }

      const playing = machine.current === 'playing';
      if (playing) {
        updateGame(game, dt);
        syncHud();
      }

      const avalancheOn = playing && game.avalanche.phase !== 'idle';
      const intensity = avalancheOn ? (game.avalanche.size / CONFIG.avalanche.maxSize) * particleScale : 0;
      avalancheTrail(pool, dt, worldToViewX(game.player.x), 0.2, -1.5, intensity);
      pool.update(dt, game.world.speed);

      // La vista continua a vivere anche in menu, pausa e game over: il pendio
      // e la mucca restano visibili dietro le schermate, ma non avanzano.
      terrain.sync(game.world);
      entitiesView.sync(game.entities);
      playerView.sync(game.player, game.avalanche.size, game.world.speed, playing ? dt : 0);
      view.update(dt, game.avalanche.size, avalancheOn);
      logStats(dt);
    },
    render(): void {
      samplePerf();
      view.render();
    },
  });

  window.addEventListener('resize', () => view.resize());

  goToMenu();
  syncHud();
  loop.start();
}

main();
