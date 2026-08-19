import './style.css';
import { createAudio } from './audio/audio';
import { createEventBus } from './core/events';
import { createLoop } from './core/loop';
import { createStateMachine, type GameStateName } from './core/state-machine';
import { CONFIG } from './game/config';
import {
  armDeath,
  commitGameOver,
  createFlow,
  isDying,
  requestExternalPause,
  resetFlow,
  tickDeath,
} from './game/flow';
import { abandonRun, advanceWorldOnly, createGame, handleAction, startRun, updateGame } from './game/game';
import { loadRecord } from './game/score';
import { createInput } from './input/input';
import { worldToViewX } from './render/camera-rig';
import { createBackdrop } from './render/backdrop';
import { avalancheTrail, burstFromModel, resetDebris } from './render/debris';
import { createEntitiesView, entityWorldOffsetX } from './render/entities-view';
import { MODELS } from './render/models';
import { createPerfMonitor } from './render/perf-monitor';
import { createPlayerView } from './render/player-view';
import { createScene } from './render/scene';
import { createScenery } from './render/scenery';
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
  const scenery = createScenery();
  const entitiesView = createEntitiesView();
  const playerView = createPlayerView();
  const backdrop = createBackdrop();
  const pool = createVoxelPool(CONFIG.render.voxelPoolSize, CONFIG.render.voxelSize);
  // Il backdrop va aggiunto per primo: è il più lontano, ma l'ordine di scene
  // graph non incide sull'ordine di disegno (quello lo decide lo z-buffer).
  view.scene.add(backdrop.group);
  view.scene.add(terrain.group);
  view.scene.add(scenery.group);
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
  const flow = createFlow();

  /** L'HUD vive SOLO in 'playing': va tenuto sincronizzato a ogni cambio schermata. */
  function showScreen(name: GameStateName): void {
    screens.show(name);
    hud.setVisible(name === 'playing');
  }

  function goToMenu(): void {
    if (machine.transition('menu')) {
      // Run abbandonata da viva (Esc → MENU, magari a metà valanga): emette
      // run:stopped, così l'audio spegne il rombo senza che main.ts lo chiami
      // mai direttamente (no-op se la run era già finita o non era iniziata).
      abandonRun(game);
      // Se si torna al menu mentre si era in pausa durante il rallentatore
      // della morte (Esc → pausa → MENU, entrambe transizioni legittime),
      // annulla esplicitamente il game over in sospeso: 'menu' non ammette
      // gameover, quindi senza questo il payload restava orfano in
      // pendingGameOver finché non arrivava un nuovo armDeath.
      resetFlow(flow);
      screens.setMenuRecord(record);
      showScreen('menu');
    }
  }

  function beginRun(): void {
    if (!machine.transition('playing')) return;
    startRun(game, Date.now());
    pool.reset();
    resetDebris();
    resetFlow(flow);
    playerView.group.visible = true;
    showScreen('playing');
  }

  function togglePause(): void {
    if (machine.current === 'playing' && machine.transition('paused')) {
      showScreen('paused');
      return;
    }
    if (machine.current === 'paused' && machine.transition('playing')) {
      showScreen('playing');
    }
  }

  function showGameOver(): void {
    const payload = commitGameOver(machine, flow);
    if (payload === null) return;
    screens.setGameOver(payload.points, record, payload.isRecord);
    showScreen('gameover');
  }

  screens.onStart(beginRun);
  screens.onRestart(beginRun);
  screens.onResume(togglePause);
  screens.onMenu(goToMenu);
  screens.onToggleMute((isMuted) => {
    audio.setMuted(isMuted);
  });

  bus.on('obstacle:hit', (payload) => {
    const hitX = worldToViewX(entityWorldOffsetX(game.path, { branch: payload.branch }));

    if (payload.outcome === 'smashed' || payload.outcome === 'forgiven') {
      burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, CONFIG.feel.smashBurstPower * particleScale);
      view.shake(CONFIG.feel.impactShake);
      return;
    }
    // morte E scudo: l'ostacolo si disintegra comunque (il colpo era "vero",
    // lo scudo lo ha solo assorbito). Il frantumarsi dello scudo stesso ha il
    // proprio burst separato, vedi bus.on('shield:consumed', ...) più sotto.
    burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, CONFIG.feel.deathBurstPower * particleScale);
    view.shake(CONFIG.feel.impactShake);
  });

  bus.on('pickup:collected', (payload) => {
    // Il giocatore è sempre al centro dello schermo (0): non esiste più una
    // x propria del player, è il mondo/i rami a scorrere lateralmente
    // (game.path.offsetX), vedi Note di progetto del task 7.
    burstFromModel(pool, MODELS[payload.kind], 0, 0.8, 0, 4 * particleScale);
  });

  bus.on('avalanche:triggered', () => {
    view.shake(CONFIG.feel.avalancheShake);
  });

  bus.on('fork:appeared', (payload) => {
    hud.setFork(payload.richBranch);
  });

  bus.on('fork:resolved', () => {
    hud.setFork(null);
  });

  bus.on('buff:gained', () => {
    burstFromModel(pool, MODELS.crystal, 0, 0.8, 0, 5 * particleScale);
    view.shake(CONFIG.feel.buffShake);
  });

  bus.on('shield:consumed', () => {
    burstFromModel(pool, MODELS.snowflake, 0, 0.8, 0, CONFIG.feel.smashBurstPower * particleScale);
    view.shake(CONFIG.feel.impactShake);
  });

  bus.on('run:ended', (payload) => {
    record = Math.max(record, payload.points);
    armDeath(flow, payload, CONFIG.feel.deathSlowSeconds);
    view.shake(CONFIG.feel.deathShake);
    burstFromModel(
      pool,
      MODELS.cow,
      0,
      0.6,
      0,
      CONFIG.feel.deathBurstPower * particleScale,
    );
    playerView.group.visible = false;
  });

  document.addEventListener('visibilitychange', () => {
    // Richiesta di pausa NON generata dal giocatore: va ignorata durante il
    // rallentatore della morte (vedi game/flow.ts), altrimenti la macchina
    // finirebbe in 'paused' proprio mentre sta per arrivare il game over.
    if (document.hidden && requestExternalPause(machine, flow)) {
      showScreen('paused');
    }
    if (document.hidden) {
      loop.stop();
    } else {
      // Il primo campione dopo una tab sospesa non deve valere l'intera durata
      // della pausa: si azzera anche il monitor perf, non solo il loop interno
      // (che si azzera già da sé in loop.start()).
      resetPerf();
      loop.start();
    }
  });

  window.addEventListener('blur', () => {
    if (requestExternalPause(machine, flow)) {
      showScreen('paused');
    }
  });

  function syncHud(): void {
    hud.setPoints(game.score.points);
    hud.setCharge(game.avalanche.charge / CONFIG.avalanche.threshold);
    hud.setSize(game.avalanche.size);
    hud.setAvalanche(game.avalanche.phase !== 'idle', game.avalanche.phase === 'warning');
    hud.setBuffs(game.buffs.shield, game.buffs.starTimeLeft, game.buffs.magnetTimeLeft);
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
      // Un campione non può contribuire più di un frame "ragionevole": senza
      // questo clamp, il primo render dopo una tab sospesa vale l'intera durata
      // della pausa e da solo supera la soglia del degrado (il monitor si
      // difende a sua volta, vedi render/perf-monitor.ts: doppia protezione).
      const clampedDt = Math.min(realDt, CONFIG.perf.maxSampleSeconds);
      if (perf.sample(clampedDt) && particleScale === 1) {
        particleScale = CONFIG.perf.lowQualityParticleScale;
        view.setQuality(true);
        console.info('[perf] frame rate basso: qualità ridotta (ombre off, meno particelle)');
      }
    }
    lastFrameMs = now;
  }

  /** Azzera il monitor perf e il riferimento all'ultimo frame: da chiamare
   *  quando il loop riparte dopo essere stato fermo (tab tornata visibile). */
  function resetPerf(): void {
    perf.reset();
    lastFrameMs = null;
  }

  const loop = createLoop({
    update(dt: number): void {
      // PAUSE va letto in qualunque stato, altrimenti da fermi Esc non riprende.
      const action = input.consume();
      if (action === 'PAUSE') {
        togglePause();
      } else if (action !== null && machine.current === 'playing' && !isDying(flow)) {
        handleAction(game, action);
      }

      // Rallentatore alla morte: la logica di gioco resta ferma (game.alive è
      // già false), ma pendio, entità, detriti e camera continuano ad animarsi
      // al rallenty finché non scade il rallentatore, poi si passa al game
      // over. Prima della correzione il pendio si fermava di colpo (return
      // prima di terrain.sync/entitiesView.sync) mentre i detriti continuavano
      // a scorrere: sembrava un problema di prestazioni, non un effetto voluto.
      if (isDying(flow)) {
        const done = tickDeath(flow, dt);
        const slowDt = dt * CONFIG.feel.deathTimeScale;
        advanceWorldOnly(game, slowDt);
        // game.world.speed NON va scalato di nuovo: dt è già rallentato
        // (slowDt), esattamente come lo riceve advanceWorldOnly. Scalarlo due
        // volte faceva arretrare i detriti a deathTimeScale² (~0.12) mentre il
        // pendio (via advanceWorldOnly) scorreva a deathTimeScale (~0.35): i
        // cubetti sembravano galleggiare rispetto al pendio invece di scorrere
        // insieme, l'artefatto opposto a quello che il fix M1 voleva eliminare.
        pool.update(slowDt, game.world.speed);
        view.update(slowDt, game.avalanche.size, false);
        backdrop.sync(view.rigPosition.x, view.rigPosition.z);
        terrain.sync(game.world, game.path);
        scenery.sync(game.world);
        entitiesView.sync(game.entities, game.path);
        logStats(dt);
        if (done) showGameOver();
        return;
      }

      const playing = machine.current === 'playing';
      if (playing) {
        updateGame(game, dt);
        syncHud();
      }

      const avalancheOn = playing && game.avalanche.phase !== 'idle';
      const intensity = avalancheOn ? (game.avalanche.size / CONFIG.avalanche.maxSize) * particleScale : 0;
      avalancheTrail(pool, dt, 0, 0.2, -1.5, intensity);
      pool.update(dt, game.world.speed);

      // La vista continua a vivere anche in menu, pausa e game over: il pendio
      // e la mucca restano visibili dietro le schermate, ma non avanzano.
      terrain.sync(game.world, game.path);
      scenery.sync(game.world);
      entitiesView.sync(game.entities, game.path);
      playerView.sync(game.player, game.avalanche.size, game.world.speed, playing ? dt : 0, game.buffs.shield);
      view.update(dt, game.avalanche.size, avalancheOn);
      backdrop.sync(view.rigPosition.x, view.rigPosition.z);
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
