import './style.css';
import * as THREE from 'three';
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
import {
  abandonRun,
  advanceWorldOnly,
  createGame,
  handleAction,
  startRun,
  updateGame,
} from './game/game';
import {
  attachQuests,
  completedQuestIds,
  createQuests,
  dailyQuestSeed,
  trackDistance,
} from './game/quests';
import { resolveDifficultyProfile } from './game/speed';
import { createInput } from './input/input';
import {
  loadCompletedQuests,
  loadDailyRecord,
  loadDifficultyName,
  loadLastDistance,
  loadRecord,
  loadRecordDistance,
  loadScopedRecord,
  loadTaughtActions,
  saveCompletedQuests,
  saveDailyRecord,
  saveDifficultyName,
  saveLastDistance,
  saveRecord,
  saveRecordDistance,
  saveScopedRecord,
  saveTaughtActions,
} from './platform/storage';
import { createAvalancheFx } from './render/avalanche-fx';
import { createBackdrop } from './render/backdrop';
import { worldToViewX } from './render/camera-rig';
import { cameraRollFor, curveMotionScale, playerTiltFor, worldYawFor } from './render/curve';
import { avalancheTrail, burstFromModel, resetDebris } from './render/debris';
import { createEntitiesView, entityWorldOffsetX } from './render/entities-view';
import { MODELS } from './render/models';
import { createPerfMonitor } from './render/perf-monitor';
import { createPlayerView } from './render/player-view';
import { createScene } from './render/scene';
import { createScenery } from './render/scenery';
import { createSnowfall } from './render/snowfall';
import { createTerrain } from './render/terrain';
import { createVoxelPool } from './render/voxel-pool';
import {
  isWebGLAvailable,
  showContextLostNotice,
  showFatalError,
  showWebGLError,
  watchContextLoss,
} from './render/webgl-support';
import { createHud, type HudBuffKind } from './ui/hud';
import {
  createScreens,
  type DifficultyId,
  type GameOverStats,
  type QuestView,
  type RunMode,
} from './ui/screens';

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

/** Le tre azioni che il primo tratto guidato insegna, una alla volta. */
type TaughtAction = 'jump' | 'slide' | 'fork';

const PROMPT_TEXT: Record<TaughtAction, string> = {
  jump: 'SALTA',
  slide: 'SCIVOLA',
  fork: 'SCEGLI',
};

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

  // La preferenza di sistema per il movimento ridotto è letta UNA VOLTA qui e
  // distribuita a chi la deve rispettare, invece di essere interrogata in tre
  // moduli diversi: mondo, camera e speed lines devono essere d'accordo, e
  // tre letture indipendenti della stessa media query sono tre occasioni di
  // divergere il giorno in cui una di loro viene dimenticata.
  const motionQuery =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  let reducedMotion = motionQuery?.matches ?? false;

  const view = createScene(canvas, reducedMotion);

  const terrain = createTerrain();
  terrain.setMaxAnisotropy(view.renderer.capabilities.getMaxAnisotropy());
  const scenery = createScenery();
  const entitiesView = createEntitiesView();
  const backdrop = createBackdrop();
  // Il pool nasce PRIMA della vista del giocatore: la scia dorata della stella
  // esce da lì, e passarlo dopo significherebbe una vista senza aura.
  const pool = createVoxelPool(CONFIG.render.voxelPoolSize, CONFIG.render.voxelSize);
  const playerView = createPlayerView(pool);
  const snow = createSnowfall();
  const avalancheFx = createAvalancheFx();
  avalancheFx.setReducedMotion(reducedMotion);

  // Pendio, entità e detriti vivono in un unico gruppo: durante un bivio è
  // QUESTO gruppo a ruotare attorno all'origine (render/curve.ts,
  // worldYawFor), dove sta sempre la mucca (x=0, z=0, vedi player-view.ts),
  // così sembra che sia lei a curvare invece che il mondo a scivolare di
  // lato in blocco. playerView NON ci va dentro apposta: la mucca resta ferma
  // al centro, è tutto il resto a muoversi intorno a lei. Il backdrop resta
  // fuori (è ancorato alla camera) ma riceve lo stesso angolo in backdrop.sync,
  // altrimenti l'orizzonte immobile smaschererebbe il trucco. La neve resta
  // fuori per la ragione opposta: deve cadere verticale qualunque cosa faccia
  // la pista, quindi non deve ruotare con il mondo.
  const worldGroup = new THREE.Group();
  worldGroup.add(terrain.group);
  worldGroup.add(scenery.group);
  worldGroup.add(entitiesView.group);
  worldGroup.add(pool.mesh);
  view.scene.add(backdrop.group);
  view.scene.add(worldGroup);
  view.scene.add(playerView.group);
  view.scene.add(snow.group);
  view.scene.add(avalancheFx.object);

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

  // ---------------------------------------------------------------- persistenza

  let profileId: DifficultyId = resolveDifficultyProfile(loadDifficultyName()).name;
  let runMode: RunMode = 'free';
  /**
   * Record dell'AMBITO in cui si sta giocando (profilo scelto, o corsa del
   * giorno), non il record storico complessivo.
   *
   * Devono essere la stessa cosa il numero mostrato e quello con cui il gioco
   * decide se è un record: passando al gioco il record del profilo e
   * mostrando quello globale, una corsa da 115 punti su un profilo mai
   * giocato annunciava "NUOVO RECORD" accanto a un record di 1446. Il record
   * complessivo continua a essere salvato, ma non è ciò che questa partita
   * sta cercando di battere.
   */
  // I record erano un numero solo; ora sono uno per profilo più quello della
  // corsa del giorno. Chi ha già giocato ha un record salvato con la vecchia
  // chiave, e lasciarlo lì significherebbe presentargli un record azzerato al
  // primo avvio dopo l'aggiornamento: viene travasato una volta sola sul
  // profilo normale, che è la taratura con cui quel punteggio è stato fatto.
  const legacyRecord = loadRecord();
  if (legacyRecord > 0 && loadScopedRecord('normal') === 0) {
    saveScopedRecord('normal', legacyRecord);
  }

  let record = loadScopedRecord(profileId);
  const taught = new Set<TaughtAction>(loadTaughtActions() as TaughtAction[]);

  const quests = createQuests(dailyQuestSeed(new Date()), loadCompletedQuests());
  attachQuests(quests, bus);

  function readRecords(): { profiles: Record<DifficultyId, number>; daily: number } {
    return {
      profiles: {
        calf: loadScopedRecord('calf'),
        normal: loadScopedRecord('normal'),
        bull: loadScopedRecord('bull'),
      },
      daily: loadDailyRecord(),
    };
  }

  /** Le missioni attraversano un confine: `game/quests.ts` è logica pura e
   *  nomina i propri campi come servono a lei (`target`, `done`), mentre
   *  l'interfaccia ne vuole una vista da disegnare (`goal`, `completed`). La
   *  traduzione sta qui, nel punto che già fa da cerniera fra i due livelli,
   *  invece di costringere uno dei due ad adottare il vocabolario dell'altro. */
  function questViews(): QuestView[] {
    return quests.quests.map((quest) => ({
      id: quest.id,
      label: quest.label,
      progress: quest.progress,
      goal: quest.target,
      completed: quest.done,
    }));
  }

  function refreshMenu(): void {
    screens.setProfile(profileId);
    screens.setRecords(readRecords());
    screens.setQuests(questViews());
  }

  // ------------------------------------------------------------------ sessione

  /** Scala applicata a burst e scia quando il monitor perf chiede il degrado. */
  let particleScale = 1;
  let statsTimer = 0;
  /** Fermo-immagine in corso: secondi residui (vedi CONFIG.feel.hitStop). */
  let hitStop = 0;

  /** Statistiche della corsa in corso, per la schermata di fine partita: sono
   *  tutte cose che il gioco già sa e che finora buttava via a ogni morte. */
  let runAvalanches = 0;
  let runMaxSize = 1;
  let runSnowflakes = 0;

  /** Rallentatore alla morte: si continua a renderizzare, poi arriva il game over. */
  const flow = createFlow();

  /** L'HUD vive SOLO in 'playing': va tenuto sincronizzato a ogni cambio schermata. */
  function showScreen(name: GameStateName): void {
    screens.show(name);
    hud.setVisible(name === 'playing');
  }

  /** Il prompt del tutorial si spegne per sempre appena l'azione riesce una
   *  volta: chi sa già saltare non deve rivedere "SALTA" a ogni partita. */
  function teach(action: TaughtAction): void {
    if (taught.has(action)) return;
    taught.add(action);
    saveTaughtActions([...taught]);
    screens.setPrompt(null);
  }

  function promptFor(action: TaughtAction): void {
    if (taught.has(action) || machine.current !== 'playing') return;
    screens.setPrompt(PROMPT_TEXT[action]);
  }

  function goToMenu(): void {
    if (machine.transition('menu')) {
      // Run abbandonata da viva (Esc → MENU, magari a metà valanga): emette
      // run:stopped, così l'audio spegne il rombo. Il riepilogo torna come
      // valore di ritorno perché quell'evento non ha payload: chi arriva a
      // 8000 punti e smette non deve perderli, che era il comportamento di
      // prima (il record si salvava solo morendo).
      const summary = abandonRun(game);
      if (summary !== null) {
        registerRunResult(summary.points, summary.distance);
      }
      // Se si torna al menu mentre si era in pausa durante il rallentatore
      // della morte (Esc → pausa → MENU, entrambe transizioni legittime),
      // annulla esplicitamente il game over in sospeso.
      resetFlow(flow);
      screens.setPrompt(null);
      refreshMenu();
      showScreen('menu');
    }
  }

  /** Un solo punto per tutto ciò che va salvato a fine corsa, comunque sia
   *  finita: morendo o abbandonando. */
  function registerRunResult(points: number, distance: number): void {
    const meters = Math.max(0, Math.floor(distance));
    record = Math.max(record, points);
    saveRecord(points);
    const scope = runMode === 'daily' ? 'daily' : profileId;
    const beatsScoped =
      runMode === 'daily' ? saveDailyRecord(points) : saveScopedRecord(scope, points);
    if (beatsScoped) saveRecordDistance(meters);
    saveLastDistance(meters);
    saveCompletedQuests(completedQuestIds(quests));
  }

  function beginRun(profile: DifficultyId, mode: RunMode): void {
    if (!machine.transition('playing')) return;
    profileId = profile;
    runMode = mode;
    saveDifficultyName(profile);

    // La corsa del giorno ha lo stesso seed per tutti — è l'unica ragione per
    // cui esiste — e per lo stesso motivo gira sempre sul profilo normale: un
    // punteggio fatto su "Vitellino" non sarebbe confrontabile con quello di
    // chiunque altro.
    const daily = mode === 'daily';
    const seed = daily ? dailyQuestSeed(new Date()) ^ CONFIG.daily.seedSalt : Date.now();
    const effectiveProfile: DifficultyId = daily ? 'normal' : profile;
    const previousRecord = daily ? loadDailyRecord() : loadScopedRecord(profile);
    // Il numero che l'interfaccia mostra e quello che il gioco cerca di
    // battere devono essere lo stesso, altrimenti si annuncia un record
    // accanto a un numero più grande.
    record = previousRecord;

    startRun(game, {
      seed,
      previousRecord,
      profileName: effectiveProfile,
      // Chi non ha ancora imparato nessuna azione corre con il primo ostacolo
      // più lontano: il tempo di leggere il prompt prima di doverci reagire.
      tutorial: taught.size === 0,
    });
    pool.reset();
    resetDebris();
    resetFlow(flow);
    runAvalanches = 0;
    runMaxSize = 1;
    runSnowflakes = 0;
    hitStop = 0;
    hud.setFork(false);
    hud.clearRecordBeaten();
    hud.setStreak(0);
    hud.setMultiplier(1);
    hud.setAvalancheFx(false);
    screens.setPrompt(null);
    playerView.group.visible = true;
    showScreen('playing');
    promptFor('jump');
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
    const meters = Math.max(0, Math.floor(payload.distance));
    const stats: GameOverStats = {
      points: payload.points,
      record,
      isRecord: payload.isRecord,
      distance: meters,
      previousDistance: lastDistanceBeforeRun,
      recordDistance: recordDistanceBeforeRun,
      avalanches: runAvalanches,
      maxSize: runMaxSize,
      snowflakes: runSnowflakes,
    };
    screens.setGameOver(stats);
    screens.setQuests(questViews());
    showScreen('gameover');
  }

  // I due termini di paragone vanno letti PRIMA che la corsa appena finita li
  // sovrascriva, altrimenti il confronto sarebbe con se stessi.
  let lastDistanceBeforeRun = loadLastDistance();
  let recordDistanceBeforeRun = loadRecordDistance();

  screens.onStart(beginRun);
  screens.onRestart(beginRun);
  screens.onResume(togglePause);
  screens.onMenu(goToMenu);
  screens.onProfileChange((profile) => {
    profileId = profile;
    saveDifficultyName(profile);
  });
  screens.onToggleMute((isMuted) => {
    audio.setMuted(isMuted);
  });
  hud.onPause(togglePause);

  // --------------------------------------------------------------- reazioni

  /** Un fermo-immagine brevissimo dà peso a un evento senza rallentare la
   *  partita: è lo stesso meccanismo del rallentatore della morte, che era
   *  finora l'unico uso della scala temporale in tutto il gioco. */
  function stopFrame(seconds: number): void {
    hitStop = Math.max(hitStop, seconds);
  }

  bus.on('obstacle:hit', (payload) => {
    const hitX = worldToViewX(entityWorldOffsetX(game.path, { branch: payload.branch }));
    // Poco sopra la BASE dell'ostacolo colpito, non a una quota fissa: un arco
    // o un cornicione stanno a spawn.overheadY, e sfondandoli i cubetti
    // comparivano all'altezza delle ginocchia invece che dove il legno si è
    // spaccato.
    const hitY = payload.y + 0.4;

    if (payload.outcome === 'smashed') {
      burstFromModel(
        pool,
        MODELS[payload.kind],
        hitX,
        hitY,
        payload.z,
        CONFIG.feel.smashBurstPower * particleScale,
      );
      view.shake(CONFIG.feel.smashShake);
      stopFrame(CONFIG.feel.hitStop.smashed);
      return;
    }
    if (payload.outcome === 'forgiven') {
      // Il perdono NON è uno sfondamento, anche se prima finivano nello stesso
      // ramo con lo stesso effetto: uno è una ricompensa, l'altro è l'errore
      // che ti è quasi costato la corsa. Deve spaventare.
      burstFromModel(
        pool,
        MODELS[payload.kind],
        hitX,
        hitY,
        payload.z,
        CONFIG.feel.deathBurstPower * particleScale,
      );
      view.shake(CONFIG.feel.forgivenShake);
      stopFrame(CONFIG.feel.hitStop.forgiven);
      return;
    }
    if (payload.outcome === 'shielded') {
      // Il colpo è assorbito dallo scudo: bus.on('shield:consumed', ...) più
      // sotto fornisce già il proprio burst e la propria scossa per questo
      // stesso hit. Aggiungerne un secondo qui raddoppierebbe l'effetto.
      return;
    }
    // morte: l'ostacolo si disintegra.
    burstFromModel(
      pool,
      MODELS[payload.kind],
      hitX,
      hitY,
      payload.z,
      CONFIG.feel.deathBurstPower * particleScale,
    );
    view.shake(CONFIG.feel.impactShake);
  });

  bus.on('pickup:collected', (payload) => {
    // Dove stava DAVVERO il raccoglibile, non addosso alla mucca. La quota
    // fissa di prima (0.8) era sbagliata per costruzione: i fiocchi nascono
    // anche su archi alti e i buff sospesi stanno a spawn.overheadY, quindi
    // l'esplosione compariva lontana dal fiocco che l'aveva prodotta — e
    // spesso dentro l'ostacolo che la mucca stava scavalcando in quel
    // momento, dove i cubetti restavano conficcati perché scorrono
    // all'indietro insieme all'ostacolo.
    burstFromModel(
      pool,
      MODELS[payload.kind],
      worldToViewX(entityWorldOffsetX(game.path, { branch: payload.branch })),
      payload.y,
      payload.z,
      4 * particleScale,
    );
    if (payload.kind === 'snowflake') runSnowflakes += 1;
  });

  bus.on('avalanche:triggered', () => {
    view.shake(CONFIG.feel.avalancheShake);
    stopFrame(CONFIG.feel.hitStop.avalanche);
    hud.setAvalancheFx(true);
    runAvalanches += 1;
  });

  bus.on('avalanche:ended', () => {
    hud.setAvalancheFx(false);
  });

  bus.on('fork:appeared', (payload) => {
    hud.setFork(true);
    // Il pannello non rivela più QUALE ramo è ricco — quello lo dice già il
    // mondo, che ne è pieno di fiocchi — ma quale si ottiene NON facendo
    // nulla, che è l'unica informazione che il mondo non può dare. È
    // l'opposto del ramo ricco.
    hud.setForkDefault(payload.richBranch === 'left' ? 'right' : 'left');
    promptFor('fork');
  });

  bus.on('fork:chosen', (payload) => {
    hud.setForkChoice(payload.side);
    teach('fork');
  });

  bus.on('fork:resolved', () => {
    hud.setFork(false);
  });

  bus.on('buff:gained', () => {
    // Solo la scossa. Il burst di cubetti arriva già da 'pickup:collected',
    // che scatta per ognuno dei quattro buff e usa il modello GIUSTO.
    view.shake(CONFIG.feel.buffShake);
  });

  bus.on('buff:expiring', (payload) => {
    // Il campanaccio non ha un badge a tempo (dà lo scudo, che è uno stato
    // binario), quindi non ha nulla da far lampeggiare.
    if (payload.kind === 'bell') return;
    const badge: HudBuffKind = payload.kind === 'crystal' ? 'shield' : payload.kind;
    hud.setBuffExpiring(badge);
  });

  bus.on('shield:consumed', () => {
    burstFromModel(pool, MODELS.snowflake, 0, 0.8, 0, CONFIG.feel.smashBurstPower * particleScale);
    view.shake(CONFIG.feel.shieldShake);
    stopFrame(CONFIG.feel.hitStop.shielded);
  });

  bus.on('size:changed', (payload) => {
    // La crescita è il cuore dell'idea originale del gioco ("cresce
    // raccogliendo fiocchi") ed era completamente muta: l'evento esisteva sul
    // bus e non lo ascoltava nessuno.
    if (payload.size > payload.previous) {
      playerView.punchSize();
      burstFromModel(
        pool,
        MODELS.snowflake,
        0,
        0.9,
        0,
        CONFIG.feel.smashBurstPower * particleScale,
      );
    }
    runMaxSize = Math.max(runMaxSize, payload.size);
  });

  bus.on('player:jumped', () => {
    playerView.squashJump();
    burstFromModel(pool, MODELS.snowflake, 0, 0.1, 0, CONFIG.feel.jumpBurstPower * particleScale);
    teach('jump');
    promptFor('slide');
  });

  bus.on('player:landed', () => {
    playerView.squashLand();
    burstFromModel(pool, MODELS.snowflake, 0, 0.1, 0, CONFIG.feel.landBurstPower * particleScale);
    view.shake(CONFIG.feel.landShake);
  });

  bus.on('player:slid', () => {
    teach('slide');
  });

  bus.on('streak:changed', (payload) => {
    hud.setStreak(payload.streak);
  });

  bus.on('record:beaten', () => {
    hud.showRecordBeaten();
  });

  bus.on('quest:completed', () => {
    saveCompletedQuests(completedQuestIds(quests));
    screens.setQuests(questViews());
  });

  bus.on('run:ended', (payload) => {
    lastDistanceBeforeRun = loadLastDistance();
    recordDistanceBeforeRun = loadRecordDistance();
    registerRunResult(payload.points, payload.distance);
    armDeath(flow, payload, CONFIG.feel.deathSlowSeconds);
    view.shake(CONFIG.feel.deathShake);
    burstFromModel(pool, MODELS.cow, 0, 0.6, 0, CONFIG.feel.deathBurstPower * particleScale);
    playerView.group.visible = false;
    screens.setPrompt(null);
  });

  // --------------------------------------------------------- eventi di sistema

  document.addEventListener('visibilitychange', () => {
    // Richiesta di pausa NON generata dal giocatore: va ignorata durante il
    // rallentatore della morte, altrimenti la macchina finirebbe in 'paused'
    // proprio mentre sta per arrivare il game over.
    if (document.hidden && requestExternalPause(machine, flow)) {
      showScreen('paused');
    }
    if (document.hidden) {
      loop.stop();
    } else {
      // Il primo campione dopo una tab sospesa non deve valere l'intera durata
      // della pausa: si azzera la MISURA del monitor perf, non la decisione
      // già presa (il degrado è permanente per la sessione).
      resetPerf();
      loop.start();
    }
  });

  window.addEventListener('blur', () => {
    if (requestExternalPause(machine, flow)) {
      showScreen('paused');
    }
  });

  motionQuery?.addEventListener('change', (event) => {
    reducedMotion = event.matches;
    view.setReducedMotion(reducedMotion);
    avalancheFx.setReducedMotion(reducedMotion);
  });

  // Su mobile la perdita del contesto WebGL è un evento ordinario (memoria
  // sotto pressione, app in background a lungo): senza questo il gioco
  // diventerebbe uno schermo nero silenzioso, perché il controllo iniziale
  // copre solo l'assenza di WebGL all'avvio, non la sua sparizione dopo.
  let contextNotice: HTMLElement | null = null;
  watchContextLoss(canvas, {
    onLost(): void {
      loop.stop();
      if (requestExternalPause(machine, flow)) showScreen('paused');
      if (contextNotice === null) contextNotice = showContextLostNotice(uiRoot);
    },
    onRestored(): void {
      contextNotice?.remove();
      contextNotice = null;
      view.resize();
      resetPerf();
      loop.start();
    },
  });

  // ------------------------------------------------------------------- loop

  function syncHud(): void {
    hud.setPoints(game.score.points);
    hud.setCharge(game.avalanche.charge / CONFIG.avalanche.threshold);
    hud.setSize(game.avalanche.size);
    hud.setAvalanche(game.avalanche.phase !== 'idle', game.avalanche.phase === 'warning');
    hud.setBuffs(game.buffs.shield, game.buffs.starTimeLeft, game.buffs.magnetTimeLeft);
    hud.setDistance(game.score.distance);
    hud.setMultiplier(game.multiplier);
  }

  /** Logga draw call e triangoli ogni CONFIG.perf.statsLogSeconds: aiuta a
   *  scovare a occhio un tipo di entità sfuggito all'istanziazione. */
  function logStats(dt: number): void {
    statsTimer += dt;
    if (statsTimer < CONFIG.perf.statsLogSeconds) return;
    statsTimer = 0;
    const info = view.renderer.info.render;
    console.info(
      `[perf] draw call: ${info.calls} | triangoli: ${info.triangles} | budget: <60 / <150000`,
    );
  }

  /**
   * Il loop interno gira a step fisso: dt qui è sempre lo stesso valore,
   * quindi non basta per misurare il framerate reale dello schermo. Il tempo
   * vero fra due frame renderizzati si misura a parte, in render().
   */
  let lastFrameMs: number | null = null;
  function samplePerf(): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (lastFrameMs !== null) {
      const realDt = (now - lastFrameMs) / 1000;
      const clampedDt = Math.min(realDt, CONFIG.perf.maxSampleSeconds);
      if (perf.sample(clampedDt) && particleScale === 1) {
        particleScale = CONFIG.perf.lowQualityParticleScale;
        view.setQuality(true);
        snow.setIntensity(CONFIG.perf.lowQualityParticleScale);
        console.info('[perf] frame rate basso: qualità ridotta (risoluzione, ombre, particelle)');
      }
    }
    lastFrameMs = now;
  }

  function resetPerf(): void {
    perf.resetSampling();
    lastFrameMs = null;
  }

  /** Rispecchia lo stato del gioco sulla scena. È lavoro IDEMPOTENTE — rifarlo
   *  due volte produce lo stesso identico frame — quindi vive qui, nel render,
   *  e non nell'update a passo fisso: là dentro, su un dispositivo lento che
   *  esegue più update per frame, ogni sincronizzazione veniva ripetuta N
   *  volte, cioè più il telefono arrancava più CPU gli si chiedeva. */
  function syncViews(dt: number, avalancheOn: boolean): void {
    const curveScale = curveMotionScale(reducedMotion);
    const yaw = worldYawFor(game.path, curveScale);
    worldGroup.rotation.y = yaw;

    terrain.sync(game.world, game.path);
    scenery.sync(game.world, view.camera.fov, view.camera.aspect, yaw);
    entitiesView.sync(game.entities, game.path, dt);
    playerView.sync({
      player: game.player,
      size: game.avalanche.size,
      speed: game.world.speed,
      dt,
      shielded: game.buffs.shield,
      tilt: playerTiltFor(game.path, curveScale),
      starTimeLeft: game.buffs.starTimeLeft,
      magnetTimeLeft: game.buffs.magnetTimeLeft,
      particleScale,
    });
    view.update({
      dt,
      size: game.avalanche.size,
      speed: game.world.speed,
      avalanche: avalancheOn,
      roll: cameraRollFor(game.path, curveScale),
    });
    backdrop.sync(view.rigPosition.x, view.rigPosition.z, yaw);
    snow.update(dt, game.world.speed, view.rigPosition.x, view.rigPosition.z);
    avalancheFx.update(dt, avalancheOn ? game.avalanche.size / CONFIG.avalanche.maxSize : 0);
  }

  /** Quanto tempo di vista è passato nell'ultimo giro di update: serve al
   *  render per animare alla stessa velocità con cui la logica è avanzata,
   *  rallentatore della morte e fermo-immagine compresi. */
  let viewDt = 0;
  let viewAvalanche = false;
  let worldMoving = false;

  const loop = createLoop({
    update(dt: number): void {
      // PAUSE va letto in qualunque stato, altrimenti da fermi Esc non riprende.
      const action = input.consume();
      if (action === 'PAUSE') {
        togglePause();
      } else if (action !== null && machine.current === 'playing' && !isDying(flow)) {
        handleAction(game, action);
      }

      // Fermo-immagine: la logica si ferma, la vista no (continua ad animare
      // con dt zero, cioè resta esattamente dov'è). Dura decine di
      // millisecondi, quindi non può accumulare ritardo apprezzabile.
      if (hitStop > 0) {
        hitStop = Math.max(0, hitStop - dt);
        viewDt = 0;
        worldMoving = false;
        return;
      }

      if (isDying(flow)) {
        const done = tickDeath(flow, dt);
        const slowDt = dt * CONFIG.feel.deathTimeScale;
        advanceWorldOnly(game, slowDt);
        // game.world.speed NON va scalato di nuovo: dt è già rallentato.
        pool.update(slowDt, game.world.speed);
        viewDt = slowDt;
        viewAvalanche = false;
        worldMoving = true;
        logStats(dt);
        if (done) showGameOver();
        return;
      }

      const playing = machine.current === 'playing';
      if (playing) {
        updateGame(game, dt);
        trackDistance(quests, game.score.distance, bus);
      }

      const avalancheOn = playing && game.avalanche.phase !== 'idle';
      const intensity = avalancheOn
        ? (game.avalanche.size / CONFIG.avalanche.maxSize) * particleScale
        : 0;
      avalancheTrail(pool, dt, 0, 0.2, -1.5, intensity);
      pool.update(dt, game.world.speed);

      viewDt = playing ? dt : 0;
      viewAvalanche = avalancheOn;
      worldMoving = playing;
      logStats(dt);
    },
    render(): void {
      samplePerf();
      if (machine.current === 'playing') syncHud();
      syncViews(viewDt, viewAvalanche);
      // La shadow map non si ridisegna più a ogni frame: a menu, in pausa e a
      // game over la scena è ferma e ridisegnarla era lavoro buttato su un
      // dispositivo che nel frattempo si scalda.
      if (worldMoving) view.needsShadowUpdate();
      view.render();
    },
  });

  // Il resize rialloca il drawing buffer: sui browser mobile la comparsa e la
  // scomparsa della barra degli indirizzi, e la rotazione, producono raffiche
  // di eventi, e ognuna sarebbe uno stallo. Si coalizzano in un solo frame.
  let resizePending = false;
  function scheduleResize(): void {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      view.resize();
    });
  }
  window.addEventListener('resize', scheduleResize);
  window.screen?.orientation?.addEventListener?.('change', scheduleResize);

  goToMenu();
  syncHud();
  loop.start();
}

// main() gira senza rete: canvas mancante, contenitore UI mancante, contesto 2D
// non disponibile, merge di geometrie fallito o un selettore dell'interfaccia
// non trovato lanciano tutti, e produrrebbero esattamente lo schermo nero che
// showWebGLError esiste per evitare — con in più un errore in console che su un
// telefono nessuno leggerà mai.
try {
  main();
} catch (error) {
  console.error('[main] avvio fallito', error);
  const root = document.getElementById('ui-root');
  if (root !== null) {
    showFatalError(root, error instanceof Error ? error.message : undefined);
  }
}
