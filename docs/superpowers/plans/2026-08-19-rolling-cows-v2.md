# Rolling Cows v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare Rolling Cows da endless runner a tre corsie a un gioco su percorso singolo che si biforca, dove si salta, si scivola e si sceglie una strada, con fiocchi in fila che insegnano l'azione, quattro buff e una valanga frequente ma breve.

**Architecture:** Il mondo diventa monodimensionale: la mucca è sempre al centro e ogni entità ha solo distanza, quota e ramo di appartenenza. Un bivio non muove la camera — è il tracciato ad avere uno scostamento laterale che si azzera dopo ogni scelta, facendo scivolare al centro il ramo imboccato. Le collisioni perdono l'asse laterale e si riducono a distanza più quota, con la regola che si collide solo con le entità del ramo attivo.

**Tech Stack:** TypeScript 5 strict, Vite 5, three.js, Vitest. Invariato rispetto alla v1, così come il deploy su GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-19-rolling-cows-v2-design.md`

## Global Constraints

- **Separazione logica/vista (non negoziabile):** `src/core/**` e `src/game/**` non importano mai `three`, non toccano il DOM e non usano `window`/`document`. `src/render/**`, `src/ui/**`, `src/input/**`, `src/audio/**` non contengono regole di gioco.
- **Ogni numero di bilanciamento sta in `src/game/config.ts`.** Zero costanti magiche negli altri moduli.
- **Zero allocazioni nel loop di gioco:** pool preallocati, array riusati con `length = 0`, compattazione in place, cicli indicizzati.
- **TypeScript `strict: true` con `noUncheckedIndexedAccess: true`.**
- **Determinismo:** ogni sorgente di casualità passa da `createRng(seed)`. Mai `Math.random()` nella logica di gioco.
- **Test affiancati al codice** (`src/game/path.test.ts`), ambiente Vitest `node`, `// @vitest-environment jsdom` solo dove serve il DOM.
- **Budget di performance:** < 60 draw call e < 150k triangoli per frame, 60fps su telefono di fascia media.
- **Comandi di verifica:** `npm run typecheck`, `npm run test:run`, `npm run build`.
- **Invariante del terreno da non perdere:** il corridoio giocabile è perfettamente piatto — `heightAt(x, z)` vale 0 dentro il corridoio ed è continuo al bordo. Un bug della v1 faceva interpolare il rilievo verso l'interno e gli ostacoli affondavano nella neve; i test che lo impediscono vanno mantenuti, non cancellati.
- **Invariante di giocabilità (sostituisce quella di solvibilità delle corsie):** due ostacoli consecutivi non possono mai distare meno di quanto serve a completare l'azione richiesta dal primo, alla velocità massima.
- Testo dell'interfaccia in italiano; identificatori e messaggi di commit in inglese.

## L'albero resta rotto dal Task 1 al Task 11

Questo piano modifica un gioco funzionante. Il Task 1 rimuove le corsie, che sono il
fondamento di mezza logica: da quel momento `npm run typecheck` fallisce e diversi test
non compilano.

Il ritorno al verde avviene in due tempi, e vanno tenuti distinti:

- **Task 7** — la LOGICA torna verde e la v2 è giocabile in simulazione: tutti i test di
  `src/core/**` e `src/game/**` passano e una corsa intera gira headless. Il typecheck
  globale resta però rosso, perché i moduli di vista usano ancora corsie e larghezze.
- **Task 11** — il TYPECHECK GLOBALE torna verde: a quel punto modelli, entità, terreno,
  giocatore, input e HUD parlano tutti il linguaggio della v2. Il Task 12 completa il
  cablaggio e il bilanciamento.

È una scelta deliberata: le corsie sono intrecciate a tipi, collisioni, spawner, giocatore
e vista, e fingere di poterle togliere un pezzo alla volta produrrebbe codice di
compatibilità da buttare subito dopo. Chi esegue il piano deve saperlo e non interpretare
il rosso intermedio come un proprio errore.

Regola operativa: dal Task 1 al Task 6 si verifica con i test del singolo modulo
(`npx vitest run src/game/path.test.ts`). Dal Task 7 in poi `npx vitest run src/core src/game`
deve essere verde a ogni commit. Dal Task 11 in poi tornano obbligatori `npm run typecheck`
e `npm run test:run` completi.

---

### Task 1: Tipi v2, configurazione v2 e rimozione delle corsie

Questo task è la demolizione. Riscrive `src/game/types.ts` secondo il contratto
(via `Branch`, addio a `Lane`/`lane`/`width`, nuovi kind di ostacoli e buff, nuove
`Action`, l'helper `isOverhead`), aggiorna `src/game/config.ts` (rimuove tutto ciò
che riguarda le corsie, aggiunge i blocchi `path` e `buffs`, aggiorna i numeri
della valanga e dei pickup), aggiunge i nuovi eventi a `src/core/events.ts` ed
elimina `src/game/lanes.ts` insieme al suo test.

**Stato del progetto dopo questo task: ROTTO, deliberatamente.** `npm run
typecheck` e `npm run test:run` (l'intera suite) restano rossi finché il Task 7
non rimette in piedi tutti i consumatori. Questo task lascia verdi solo i test
che gli appartengono (`src/game/types.test.ts`, `src/game/config.test.ts`), che
si eseguono singolarmente. È una scelta esplicita, non un incidente: demolire e
ricostruire nello stesso task avrebbe significato riscrivere `collisions.ts`,
`player.ts`, `spawner.ts`, `game.ts`, `entities-view.ts`, `terrain.ts`, `main.ts`,
`input.ts` e `gesture.ts` (e tutti i loro test) in un solo task enorme, il
contrario dell'incrementalità che il resto del piano rispetta.

**Files:**
- Modify: `src/game/types.ts`
- Modify: `src/game/config.ts`
- Modify: `src/core/events.ts`
- Delete: `src/game/lanes.ts`
- Delete: `src/game/lanes.test.ts`
- Test: `src/game/types.test.ts` (nuovo)
- Test: `src/game/config.test.ts` (nuovo)

**Interfaces:**
- Consumes: niente di nuovo — `types.ts`, `config.ts` ed `events.ts` sono le
  foglie della dipendenza (nessuno dei tre importa altro codice di gioco).
- Produces:
  - `export type Branch = 'main' | 'left' | 'right';`
  - `export type GroundObstacleKind = 'rock' | 'log' | 'fence' | 'crevasse';`
  - `export type OverheadObstacleKind = 'branch' | 'arch' | 'cornice';`
  - `export type ObstacleKind = GroundObstacleKind | OverheadObstacleKind;`
  - `export type BuffKind = 'crystal' | 'star' | 'magnet' | 'bell';`
  - `export type PickupKind = 'snowflake' | BuffKind;`
  - `export type EntityKind = ObstacleKind | PickupKind;`
  - `export type Action = 'CHOOSE_LEFT' | 'CHOOSE_RIGHT' | 'JUMP' | 'SLIDE' | 'PAUSE';`
  - `export interface Entity { id: number; kind: EntityKind; category: 'obstacle' | 'pickup'; branch: Branch; z: number; y: number; alive: boolean; }`
  - `export function isOverhead(kind: EntityKind): boolean;`
  - `export const CONFIG` con i blocchi `world` (senza corsie, con `trackWidth`),
    `path` (nuovo), `player` (senza `laneChangeSeconds`/`slamGroundSeconds`,
    con `slideSeconds`/`slideHeightRatio`/`diveGravityMultiplier`),
    `collisions.entityBox` (nuovi kind), `avalanche` (numeri v2), `forgiveness`
    (invariato), `pickups.charge` (nuovi kind), `buffs` (nuovo), `score`
    (invariato), `spawn` (nuovo, per tracciato invece che per corsie), `render`,
    `input`, `audio`, `perf`, `feel` (tutti invariati).
  - `GameEvents` con `'obstacle:hit'` che porta `branch: Branch` invece di
    `lane: Lane`, e i nuovi eventi `'fork:appeared'`, `'fork:chosen'`,
    `'fork:resolved'`, `'buff:gained'`, `'buff:expired'`, `'shield:consumed'`.

**Cosa si rompe SUBITO e perché (non lo sistema questo task).**

| File | Perché smette di compilare |
|---|---|
| `src/game/collisions.ts` | `import { entityCenterX, entityHalfWidth } from './lanes'` (modulo cancellato); usa `entity.lane`/`entity.width`, che non esistono più su `Entity`; `ENTITY_BOX` non copre più `tree`/`cabin`/`hay`/`cow`. |
| `src/game/player.ts` | `import { clampLane, laneToX } from './lanes'` (cancellato); `PlayerState.lane: Lane` (`Lane` non esiste più); legge `CONFIG.player.laneChangeSeconds`/`slamGroundSeconds`/`slamGravityMultiplier`, tutti rimossi dal nuovo blocco `player`. |
| `src/game/spawner.ts` | `import type { Lane } from './types'` (rimosso); legge `CONFIG.world.laneCount` e `CONFIG.spawn.rowSpacing/rowFillChanceMin/rowFillChanceMax/maxBlockedLanes/pickupChance/cowChance/hayChance/cabinChanceBase.../branchChanceBase.../branchY`, tutti spariti dal nuovo blocco `spawn`; usa i kind `tree`/`cabin`/`hay`/`cow`, non più in `EntityKind`. |
| `src/game/game.ts` | `import { moveLane } from './player'` (funzione che sparirà al Task 3); `switch(action)` sui casi `MOVE_LEFT`/`MOVE_RIGHT`/`SLAM`, non più validi per `Action`; legge `entity.lane` in `hitObstacle`; legge `CONFIG.startBelt` e `CONFIG.spawn.rowSpacing`, entrambi rimossi; `isPickupKind` riconosce `'hay'`/`'cow'`, non più kind validi. |
| `src/render/entities-view.ts` | `import { entityCenterX } from '../game/lanes'` (cancellato); `ENTITY_KINDS`, `MODEL_LANES`, `CASTS_SHADOW` elencano `tree`/`cabin`/`hay`/`cow`; legge `entity.lane`/`entity.width`. |
| `src/render/terrain.ts` | Legge `CONFIG.world.laneCount` e `CONFIG.world.laneWidth`, sostituiti da `CONFIG.world.trackWidth`. |
| `src/main.ts` | `import { entityCenterX } from './game/lanes'` (cancellato); legge `payload.lane` sull'evento `obstacle:hit` (ora `branch`); indicizza `MODELS[payload.kind]` anche per kind ormai fuori da `EntityKind`. |
| `src/input/gesture.ts` | `gestureToAction` restituisce `'MOVE_LEFT'`/`'MOVE_RIGHT'`/`'SLAM'`, non più valori di `Action`. |
| `src/input/input.ts` | La mappa tasti produce gli stessi valori di `Action` ormai inesistenti. |
| `src/game/player.test.ts` | Importa `laneToX` da `./lanes`; usa `moveLane`, `player.lane`, `CONFIG.player.laneChangeSeconds`. |
| `src/game/collisions.test.ts` | Importa `laneToX` da `./lanes`; usa il tipo `Lane`, `entity.lane`/`entity.width`, `CONFIG.world.laneWidth`. |
| `src/game/spawner.test.ts` | Usa `CONFIG.world.laneCount`, `CONFIG.spawn.maxBlockedLanes`, `entity.lane`/`entity.width`. |
| `src/game/game.test.ts` | Usa `entity.lane`/`entity.width`, il payload `obstacle:hit.lane`, `game.player.lane`, le azioni `MOVE_LEFT`/`MOVE_RIGHT`/`SLAM`. |
| `src/render/instancing.test.ts` | Importa il tipo `Lane`; usa `entity.lane`/`entity.width`. |
| `src/render/models.test.ts` | Usa `CONFIG.world.laneWidth`. |
| `src/render/terrain.test.ts` | Usa `CONFIG.world.laneCount` e `CONFIG.world.laneWidth`. |
| `src/audio/audio.test.ts` | Costruisce un payload `obstacle:hit` con il campo `lane` (ora `branch`). |
| `src/core/events.test.ts` | Stesso motivo: payload `obstacle:hit` con `lane`. |
| `src/input/gesture.test.ts` | Si aspetta `'MOVE_RIGHT'`/`'MOVE_LEFT'`/`'SLAM'` da `gestureToAction`. |
| `src/input/input.test.ts` | Si aspetta gli stessi valori da `input.consume()`. |

Questi 19 file **non vengono toccati** da questo task. `src/game/lanes.ts` e
`src/game/lanes.test.ts` vengono invece cancellati per intero, perché testano
esattamente il meccanismo eliminato (`laneToX`, `entityCenterX`,
`entityHalfWidth`, `clampLane`): non c'è nulla da "aggiornare", quel test
descrive una geometria che non esiste più. Nessun altro test viene toccato o
messo in `.skip` qui: sarebbe inutile, perché la maggior parte fallirebbe comunque
in fase di risoluzione dei moduli (import da `./lanes`) prima ancora che Vitest
arrivi a valutare uno `skip`. La tabella sopra è la dichiarazione onesta prevista
dal contratto; ogni riga verrà richiusa nei task successivi (`player.ts` e il suo
test al Task 3; gli altri via i task successivi, fino al Task 7 compreso).

- [ ] **Step 1: Scrivi i test che falliscono**

`src/game/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isOverhead } from './types';
import type { EntityKind } from './types';

const GROUND_KINDS: readonly EntityKind[] = ['rock', 'log', 'fence', 'crevasse'];
const OVERHEAD_KINDS: readonly EntityKind[] = ['branch', 'arch', 'cornice'];
const PICKUP_KINDS: readonly EntityKind[] = ['snowflake', 'crystal', 'star', 'magnet', 'bell'];

describe('isOverhead', () => {
  it('è vero per ogni ostacolo sospeso', () => {
    for (const kind of OVERHEAD_KINDS) {
      expect(isOverhead(kind)).toBe(true);
    }
  });

  it('è falso per ogni ostacolo a terra', () => {
    for (const kind of GROUND_KINDS) {
      expect(isOverhead(kind)).toBe(false);
    }
  });

  it('è falso per ogni raccoglibile', () => {
    for (const kind of PICKUP_KINDS) {
      expect(isOverhead(kind)).toBe(false);
    }
  });
});
```

`src/game/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';

describe('CONFIG.world', () => {
  it('sostituisce le corsie con una larghezza unica di tracciato', () => {
    expect(CONFIG.world.trackWidth).toBe(4);
    expect('laneCount' in CONFIG.world).toBe(false);
    expect('laneWidth' in CONFIG.world).toBe(false);
  });
});

describe('CONFIG.path', () => {
  it('contiene i parametri esatti del bivio', () => {
    expect(CONFIG.path.branchSeparation).toBe(6);
    expect(CONFIG.path.previewZ).toBe(90);
    expect(CONFIG.path.commitZ).toBe(12);
    expect(CONFIG.path.realignSeconds).toBe(0.6);
    expect(CONFIG.path.minGap).toBe(120);
    expect(CONFIG.path.gapPerSpeed).toBe(6);
  });
});

describe('CONFIG.player', () => {
  it('ha i numeri di salto e scivolata della v2, senza corsie', () => {
    expect(CONFIG.player.jumpSeconds).toBe(0.55);
    expect(CONFIG.player.jumpHeight).toBe(3.2);
    expect(CONFIG.player.slideSeconds).toBe(0.55);
    expect(CONFIG.player.slideHeightRatio).toBe(0.45);
    expect(CONFIG.player.diveGravityMultiplier).toBe(3.5);
    expect('laneChangeSeconds' in CONFIG.player).toBe(false);
    expect('slamGroundSeconds' in CONFIG.player).toBe(false);
  });
});

describe('CONFIG.avalanche', () => {
  it('ha il ritmo più rapido della v2', () => {
    expect(CONFIG.avalanche.threshold).toBe(100);
    expect(CONFIG.avalanche.durationSeconds).toBe(4.5);
    expect(CONFIG.avalanche.warningSeconds).toBe(1);
    expect(CONFIG.avalanche.scoreMultiplier).toBe(5);
  });
});

describe('CONFIG.pickups', () => {
  it('dà 4 di carica per fiocco e 20 per cristallo, 0 per i buff a stato', () => {
    expect(CONFIG.pickups.charge.snowflake).toBe(4);
    expect(CONFIG.pickups.charge.crystal).toBe(20);
    expect(CONFIG.pickups.charge.star).toBe(0);
    expect(CONFIG.pickups.charge.magnet).toBe(0);
    expect(CONFIG.pickups.charge.bell).toBe(0);
  });
});

describe('CONFIG.buffs', () => {
  it('contiene le durate e il raggio della calamita', () => {
    expect(CONFIG.buffs.starSeconds).toBe(8);
    expect(CONFIG.buffs.starMultiplier).toBe(2);
    expect(CONFIG.buffs.magnetSeconds).toBe(8);
    expect(CONFIG.buffs.magnetRangeZ).toBe(14);
  });
});

describe('CONFIG.spawn', () => {
  it('contiene i parametri di percorso invece delle righe per corsia', () => {
    expect(CONFIG.spawn.minObstacleGap).toBe(26);
    expect(CONFIG.spawn.maxObstacleGap).toBe(48);
    expect(CONFIG.spawn.trailMin).toBe(6);
    expect(CONFIG.spawn.trailMax).toBe(10);
    expect(CONFIG.spawn.trailSpacing).toBe(3);
    expect(CONFIG.spawn.trailArcHeight).toBe(3);
    expect(CONFIG.spawn.overheadY).toBe(1.6);
    expect(CONFIG.spawn.buffChance).toBeCloseTo(0.22);
    expect(CONFIG.spawn.buffWeights).toEqual({ crystal: 6, star: 3, magnet: 3, bell: 1 });
    expect('rowSpacing' in CONFIG.spawn).toBe(false);
    expect('maxBlockedLanes' in CONFIG.spawn).toBe(false);
  });
});

describe('CONFIG.collisions.entityBox', () => {
  it('copre tutti i nuovi kind di entità con le misure del contratto', () => {
    expect(CONFIG.collisions.entityBox.rock).toEqual({ height: 1.4, depth: 1.4 });
    expect(CONFIG.collisions.entityBox.log).toEqual({ height: 1, depth: 1.2 });
    expect(CONFIG.collisions.entityBox.fence).toEqual({ height: 1.2, depth: 0.8 });
    expect(CONFIG.collisions.entityBox.crevasse).toEqual({ height: 0.1, depth: 4 });
    expect(CONFIG.collisions.entityBox.branch).toEqual({ height: 1.2, depth: 0.8 });
    expect(CONFIG.collisions.entityBox.arch).toEqual({ height: 1.4, depth: 1 });
    expect(CONFIG.collisions.entityBox.cornice).toEqual({ height: 1.6, depth: 1.2 });
    expect(CONFIG.collisions.entityBox.snowflake).toEqual({ height: 0.8, depth: 0.8 });
    expect(CONFIG.collisions.entityBox.crystal).toEqual({ height: 1, depth: 1 });
    expect(CONFIG.collisions.entityBox.star).toEqual({ height: 1, depth: 1 });
    expect(CONFIG.collisions.entityBox.magnet).toEqual({ height: 1, depth: 1 });
    expect(CONFIG.collisions.entityBox.bell).toEqual({ height: 1, depth: 1 });
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Comando: `npm run test:run -- src/game/types.test.ts src/game/config.test.ts`

Atteso: FAIL. `types.test.ts` fallisce con `isOverhead is not a function` (non è
ancora esportata); `config.test.ts` fallisce sul primo `expect(CONFIG.world.trackWidth)`
perché il campo non esiste (`undefined`).

- [ ] **Step 3: Implementa il minimo necessario**

`src/game/types.ts`:

```ts
/** Ramo del tracciato a cui appartiene un'entità. */
export type Branch = 'main' | 'left' | 'right';

/** Ostacoli a terra: si saltano. */
export type GroundObstacleKind = 'rock' | 'log' | 'fence' | 'crevasse';
/** Ostacoli sospesi: ci si passa sotto scivolando. */
export type OverheadObstacleKind = 'branch' | 'arch' | 'cornice';
export type ObstacleKind = GroundObstacleKind | OverheadObstacleKind;

/** Raccoglibili. 'snowflake' è il fiocco; gli altri sono buff. */
export type BuffKind = 'crystal' | 'star' | 'magnet' | 'bell';
export type PickupKind = 'snowflake' | BuffKind;

export type EntityKind = ObstacleKind | PickupKind;

export type Action = 'CHOOSE_LEFT' | 'CHOOSE_RIGHT' | 'JUMP' | 'SLIDE' | 'PAUSE';

/** Un ostacolo o raccoglibile posizionato sul percorso. */
export interface Entity {
  id: number;
  kind: EntityKind;
  category: 'obstacle' | 'pickup';
  /** Ramo di appartenenza. Le entità 'main' sono sempre solide. */
  branch: Branch;
  /** Distanza davanti al giocatore lungo l'asse di scorrimento. Cala nel tempo. */
  z: number;
  /** Quota della base dell'entità (0 = a terra). Gli ostacoli sospesi stanno in alto. */
  y: number;
  alive: boolean;
}

const OVERHEAD_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>(['branch', 'arch', 'cornice']);

/** Vero per gli ostacoli sospesi, che richiedono la scivolata. */
export function isOverhead(kind: EntityKind): boolean {
  return OVERHEAD_KINDS.has(kind);
}
```

`src/game/config.ts`:

```ts
export const CONFIG = {
  world: {
    trackWidth: 4,
    startSpeed: 18,
    maxSpeed: 40,
    speedGrowth: 6,
    speedRefDistance: 150,
    chunkLength: 40,
    chunkCount: 6,
    despawnBehindZ: -20,
    /** Zona franca davanti al giocatore alla partenza: nessuna entità nasce sotto questa z. */
    spawnSafeZ: 25,
  },
  path: {
    /** Distanza laterale di ciascun ramo dal centro durante un bivio. */
    branchSeparation: 6,
    /** A che distanza il bivio diventa visibile. */
    previewZ: 90,
    /** Punto di non ritorno, in unità prima della biforcazione. */
    commitZ: 12,
    /** Durata del riallineamento del ramo scelto verso il centro. */
    realignSeconds: 0.6,
    /** Distanza minima fra due bivi, a velocità di partenza. */
    minGap: 120,
    /** Quanto la distanza minima cresce con la velocità (unità per u/s). */
    gapPerSpeed: 6,
  },
  player: {
    jumpSeconds: 0.55,
    jumpHeight: 3.2,
    slideSeconds: 0.55,
    /** Fattore di schiacciamento della sagoma e del modello in scivolata. */
    slideHeightRatio: 0.45,
    diveGravityMultiplier: 3.5,
    baseHeight: 1.2,
    heightPerSize: 0.25,
    depth: 1.4,
    baseHalfWidth: 0.45,
    halfWidthPerSize: 0.11,
  },
  collisions: {
    /** Ingombro verticale e in profondità di ogni tipo di entità. Non c'è più
     *  un asse laterale: le collisioni si riducono a z e quota (vedi
     *  game/collisions.ts, task successivo). */
    entityBox: {
      /** Masso basso e tozzo: si scavalca solo saltando. */
      rock: { height: 1.4, depth: 1.4 },
      /** Tronco caduto: basso, si salta. */
      log: { height: 1, depth: 1.2 },
      /** Staccionata: bassa e sottile, il salto ci passa sopra comodamente. */
      fence: { height: 1.2, depth: 0.8 },
      /** Crepaccio: praticamente piatto, largo: va anticipato con il salto. */
      crevasse: { height: 0.1, depth: 4 },
      /** Ramo di abete: sospeso, ci si passa sotto scivolando. */
      branch: { height: 1.2, depth: 0.8 },
      /** Arco di roccia: sospeso, più alto del ramo. */
      arch: { height: 1.4, depth: 1 },
      /** Cornicione di ghiaccio: sospeso, il più alto e profondo. */
      cornice: { height: 1.6, depth: 1.2 },
      /** Fiocco di neve: piccolo, ma la raccolta è generosa. */
      snowflake: { height: 0.8, depth: 0.8 },
      /** Cristallo di ghiaccio: +carica in un colpo. */
      crystal: { height: 1, depth: 1 },
      /** Stella: punti doppi a tempo. */
      star: { height: 1, depth: 1 },
      /** Calamita: attira i fiocchi a tempo. */
      magnet: { height: 1, depth: 1 },
      /** Campanaccio: scudo che assorbe un impatto. */
      bell: { height: 1, depth: 1 },
    },
  },
  avalanche: {
    threshold: 100,
    durationSeconds: 4.5,
    warningSeconds: 1,
    scoreMultiplier: 5,
    /** Soglie di carica per taglia 1..5 */
    sizeThresholds: [0, 20, 40, 60, 80],
    maxSize: 5,
    /** Taglia minima per sfondare gli ostacoli durante la valanga */
    smashMinSize: 3,
  },
  forgiveness: {
    enabled: true,
    minChargeRatio: 0.5,
    sizePenalty: 1,
  },
  pickups: {
    /** Carica data da ogni raccoglibile. star/magnet/bell non danno carica: il
     *  loro effetto è lo stato di buff che attivano, non un numero (vedi
     *  game/buffs.ts, task successivo). */
    charge: { snowflake: 4, crystal: 20, star: 0, magnet: 0, bell: 0 },
  },
  buffs: {
    starSeconds: 8,
    starMultiplier: 2,
    magnetSeconds: 8,
    /** Raggio entro cui la calamita raccoglie i fiocchi. */
    magnetRangeZ: 14,
  },
  score: {
    pointsPerUnit: 1,
    // NOTA: chiavi non ancora aggiornate al nuovo PickupKind. Il contratto
    // lascia esplicitamente questo blocco "invariato salvo dove indicato nei
    // task": la riscrittura (nuove chiavi, nuovi importi) tocca a un task
    // successivo, insieme a game.ts che le consuma via CONFIG.score.pickupBonus[kind].
    pickupBonus: { snowflake: 5, hay: 25, cow: 50 },
    smashBonus: 30,
    recordKey: 'rollingcows.record',
  },
  spawn: {
    /** Passo minimo fra due ostacoli consecutivi, in unità. */
    minObstacleGap: 26,
    maxObstacleGap: 48,
    /** Lunghezza di una fila di fiocchi. */
    trailMin: 6,
    trailMax: 10,
    /** Passo fra due fiocchi della stessa fila. */
    trailSpacing: 3,
    /** Altezza dell'apice di una fila ad arco. */
    trailArcHeight: 3,
    difficultyRampDistance: 2500,
    overheadY: 1.6,
    buffChance: 0.22,
    /** Peso relativo dei buff quando ne esce uno. */
    buffWeights: { crystal: 6, star: 3, magnet: 3, bell: 1 },
  },
  render: {
    maxPixelRatio: 2,
    // Nebbia spostata più lontano insieme alla camera rialzata (vedi
    // render/camera-rig.ts, CAMERA_HEIGHT_RATIO): a fogNear=40 il pendio
    // sbiancava proprio dove iniziava a leggersi un ostacolo lontano, lasciando
    // meno di un secondo di preavviso a velocità di crociera.
    fogNear: 75,
    fogFar: 200,
    voxelPoolSize: 4000,
    voxelSize: 0.25,
    cameraBaseDistance: 9,
    cameraDistancePerSize: 0.9,
    cameraBaseFov: 60,
    cameraAvalancheFov: 78,
    shakeDecay: 4,
    /** Quanto il terreno si estende oltre le corsie giocabili (banchi inclusi),
     *  per lato. Con fov 60 e camera a ~9 unità di distanza il frustum è largo
     *  circa 26 unità a z=40 e 64 a z=120: senza questo margine, sotto ai banchi
     *  laterali (sospesi, base a y≈-1) si vedeva il cielo. Il corridoio
     *  giocabile (vedi world.laneCount/laneWidth) resta invariato: questo
     *  numero allarga solo ciò che sta oltre le corsie. */
    groundExtraWidth: 220,
    /** Oltre questa distanza laterale dal corridoio (in unità di CORRIDOR_HALF)
     *  il rilievo procedurale del terreno smette di crescere e resta un pendio
     *  pieno: senza un tetto, il termine quadratico dell'ondulazione produce
     *  altezze assurde ai bordi di una mesh larga groundExtraWidth.
     *  A 6 (precedente) il tetto era ~80 unità: pareti di neve alte 50 volte
     *  la mucca, che nascondevano gli ostacoli lontani invece di lasciarli
     *  stagliare contro il cielo. A 1.2, con i coefficienti di
     *  render/terrain.ts (displaceGround), il tetto reale è ~3.8 unità: una
     *  conca larga e bassa, non più una gola. Vedi anche render.backdrop.*BaseY,
     *  che assumono questo tetto come altezza massima plausibile del pendio. */
    groundMaxLateralRise: 1.2,
    /** Altezza e posizione verticale (base) dei banchi laterali: la base deve
     *  restare sempre sotto il punto più basso plausibile del pendio adiacente
     *  (≈0, il pavimento del corridoio: vedi displaceGround, che a distanza
     *  laterale nulla vale sempre 0), qualunque sia l'ondulazione in quel
     *  punto, altrimenti si vede la sua base fluttuare nel vuoto. L'altezza è
     *  stata dimezzata rispetto a prima (8) insieme al ribasso del pendio
     *  (groundMaxLateralRise): un banco alto 8 unità accanto a un pendio alto
     *  al più 3.8 sembrava un muro slegato dal paesaggio. bankBottomY è stato
     *  alzato di conseguenza (non più -6) perché il TETTO del banco
     *  (bankBottomY + bankHeight) resti comunque sopra il pendio vicino invece
     *  di sprofondarci sotto e sparire. */
    bankHeight: 2.5,
    bankBottomY: -0.5,
    /** Sfondo lontano (creste innevate + fondovalle con un paese), ancorato
     *  alla camera sul piano orizzontale (vedi render/backdrop.ts): non è mai
     *  raggiungibile e non scorre via con i chunk del pendio. */
    backdrop: {
      /** Seed fisso: stesso panorama a ogni avvio. Mai Math.random, per lo
       *  stesso motivo di ogni altra generazione procedurale del progetto. */
      seed: 0x8a1e5eed,
      /** Piani di creste, dal più vicino (più saturo) al più lontano (più
       *  chiaro e desaturato): dà la prospettiva atmosferica. */
      ridgeLayers: 3,
      /** Profondità (oltre la camera, lungo z) del primo piano di creste. */
      ridgeBaseDistance: 150,
      /** Passo in profondità fra un piano di creste e il successivo. */
      ridgeLayerSpacing: 35,
      /** Picchi per cresta (vedi generateRidgeProfile). */
      ridgeSegments: 18,
      /** Larghezza del piano più vicino: i piani più lontani scalano con la
       *  distanza, per restare larghi quanto il FOV massimo (avalancheFov). */
      ridgeWidth: 480,
      /** Altezza di un picco sopra ridgeBaseY, PER IL PIANO PIÙ VICINO: i
       *  piani più lontani scalano con la distanza (come ridgeWidth), non
       *  restano fissi, altrimenti a distanza le creste rimpicciolirebbero
       *  fino a un filo. Tarata sul frustum reale (fov verticale 60°/78°,
       *  camera inclinata di CAMERA_HEIGHT_RATIO=0.68, vedi camera-rig.ts):
       *  nel caso peggiore (taglia massima, fov base 60°, quindi il minor
       *  margine sopra l'orizzonte) il picco più alto arriva a ~9.3° sopra
       *  l'orizzonte, contro un margine disponibile di ~11.6° prima del
       *  bordo dello schermo. Con 46 (valore precedente) il picco arrivava a
       *  oltre 30°: ben fuori dall'inquadratura, si vedevano solo due
       *  triangoli tagliati agli angoli. */
      ridgePeakHeight: 22,
      /** Variazione casuale (±) dell'altezza di ogni picco (anche questa
       *  scala per piano insieme a ridgePeakHeight). */
      ridgePeakVariance: 5,
      /** Quota della base delle creste. Deve restare sopra il rilievo
       *  massimo del pendio (render.groundMaxLateralRise, ≈3.8 unità con i
       *  coefficienti attuali di displaceGround) con un margine di
       *  sicurezza: il pendio è opaco e più vicino della camera, quindi
       *  qualunque cosa stia sotto la sua altezza massima in qualunque punto
       *  del corridoio o dei suoi bordi finirebbe nascosta dietro di esso,
       *  invisibile. Con questo valore la base delle creste cade comunque
       *  appena sotto la linea dell'orizzonte (fra -0.3° e -1.4° a seconda
       *  della taglia), come una vera catena che emerge dalla valle. */
      ridgeBaseY: 5,
      /** Colore del piano di creste più vicino (verso la cima: la base è
       *  sfumata verso hazeColor, vedi ridgeHazeMix). */
      ridgeColorNear: 0x7897ab,
      /** Colore del piano di creste più lontano: quasi bianco, prospettiva
       *  atmosferica. */
      ridgeColorFar: 0xe6eef4,
      /** Colore della foschia: STESSO valore di FOG_COLOR in render/scene.ts
       *  (duplicato apposta, non importato: sono due moduli indipendenti, e
       *  il vincolo è "sembra la stessa foschia", non una dipendenza fra
       *  file). Usato per sfumare verso il nulla sia la base delle creste sia
       *  il bordo vicino del fondovalle, così il punto dove il pendio
       *  (sbiancato dalla nebbia del corridoio) incontra lo sfondo non è più
       *  un bordo netto fra due colori pieni. */
      hazeColor: 0xdfeeff,
      /** Quanto la base di ogni cresta è tinta di foschia (0 = colore pieno
       *  fino in fondo, 1 = tutta foschia): sfuma la cresta invece di
       *  lasciarla un blocco di colore piatto che stacca di netto dal resto. */
      ridgeHazeMix: 0.55,
      /** Quota del fondovalle: stessa ragione di ridgeBaseY, sopra il
       *  rilievo massimo del pendio. Con la taglia minima (camera più bassa)
       *  resta comunque sotto la linea dell'orizzonte (vedi village.*). */
      valleyY: 5,
      /** Profondità e ampiezza in z del fondovalle (fra la camera e le
       *  creste): il bordo lontano (valleyDistance + valleyDepth = 215) resta
       *  volutamente entro l'ultimo piano di creste (ridgeBaseDistance +
       *  2 * ridgeLayerSpacing = 220), così il fondovalle non sporge oltre le
       *  montagne più lontane. */
      valleyDistance: 90,
      valleyDepth: 125,
      /** Larghezza del fondovalle. */
      valleyWidth: 620,
      /** Colore del fondovalle nella parte lontana (verso le creste): il
       *  bordo vicino (verso la camera) è invece sfumato a hazeColor, così
       *  non c'è un bordo netto contro il pendio innevato in primo piano. */
      valleyColor: 0xc7d8e2,
      village: {
        /** Numero di case: una di queste (scelta dall'rng) diventa il
         *  campanile. */
        houseCount: 9,
        /** Semi-ampiezza dell'area occupata dal villaggio nel fondovalle. */
        spread: 22,
        /** Profondità del centro del villaggio. */
        distance: 110,
        /** Altezza ASSOLUTA (in unità di mondo) di una casa, non uno
         *  scalare: piccola apposta e sopra tutto tarata perché la cima resti
         *  sotto la linea dell'orizzonte a qualunque taglia della camera (il
         *  caso peggiore è la taglia minima, camera più bassa: qui la cima
         *  della torre più alta del villaggio deve restare sotto tutti e
         *  due), altrimenti il paese "galleggia" sulla linea dell'orizzonte
         *  come un adesivo invece di leggersi come appoggiato nel fondovalle,
         *  molto lontano e molto in basso. */
        houseHeight: 0.35,
        /** Altezza assoluta del campanile (stessa unità di houseHeight, non
         *  più un moltiplicatore): resta il più alto del villaggio ma non si
         *  avvicina neanche lontanamente alla scala delle creste. */
        towerHeight: 0.8,
        /** Colore pareti: freddo e desaturato, un registro visivo diverso da
         *  quello vivace degli ostacoli. */
        wallColor: 0xcdd6de,
        /** Colore tetti: blu-grigio spento. Deliberatamente NON il rosso
         *  saturo del tetto della baita (models.ts, ROOF = 0xb43a3a):
         *  altrimenti i tetti del paese si confonderebbero a colpo d'occhio
         *  con un ostacolo. */
        roofColor: 0x6c7f91,
      },
    },
  },
  input: {
    swipeMinPixels: 24,
    swipeMaxMs: 400,
    bufferSeconds: 0.18,
  },
  audio: {
    /** Volume del bus principale: tutto passa di qui. */
    masterVolume: 0.35,
    mutedKey: 'rollingcows.muted',
    /** Durata del buffer di rumore bianco riusato da impatti e rombo. */
    noiseSeconds: 1,
    /** Muggito: sawtooth con portamento discendente. */
    moo: { startHz: 220, endHz: 110, seconds: 0.5, attackRatio: 0.12, gain: 0.9 },
    /** Impatto: rumore bianco passa-basso con decadimento rapido. */
    impact: { cutoffHz: 700, seconds: 0.28, gain: 1 },
    /** Raccolta: triangolare con salto di frequenza verso l'alto. */
    pickup: { lowHz: 620, highHz: 990, stepRatio: 0.35, seconds: 0.18, gain: 0.5 },
    /** Rombo della valanga: rumore filtrato in loop. */
    rumble: { cutoffHz: 380, maxGain: 0.8, riseSeconds: 0.4, fadeSeconds: 0.8, endingGainRatio: 0.4 },
  },
  perf: {
    lowFpsThreshold: 45,
    lowFpsSeconds: 3,
    /** Costante di tempo della media mobile degli FPS, in secondi. */
    smoothingSeconds: 0.5,
    /** Fattore applicato alle particelle quando la qualità viene abbassata. */
    lowQualityParticleScale: 0.35,
    /** Ogni quanti secondi loggare draw call e triangoli in console. */
    statsLogSeconds: 5,
    /** Tetto al contributo di UN SINGOLO campione (in secondi), sia nel monitor
     *  sia nel clamp lato main.ts prima di passargli il dt reale: senza questo,
     *  il primo frame dopo una tab sospesa vale l'intera durata della pausa e da
     *  solo supera lowFpsSeconds, spegnendo ombre e particelle per sempre su un
     *  dispositivo che non è mai stato lento. */
    maxSampleSeconds: 0.1,
  },
  feel: {
    /** Rallentatore alla morte: quanto dura e quanto rallenta. */
    deathSlowSeconds: 0.8,
    deathTimeScale: 0.35,
    /** Ampiezza dello scuotimento di camera per i vari eventi. */
    impactShake: 0.7,
    avalancheShake: 1.1,
    deathShake: 1.6,
    /** Potenza dell'esplosione di cubetti. */
    deathBurstPower: 9,
    smashBurstPower: 6,
  },
} as const;
```

`src/core/events.ts`:

```ts
import type { Branch, BuffKind, ObstacleKind, PickupKind } from '../game/types';

export interface GameEvents {
  'run:started': { seed: number };
  'run:ended': { points: number; distance: number; isRecord: boolean };
  /** Run abbandonata da viva (es. il giocatore torna al menu con Esc/MENU
   *  mentre è ancora vivo): DIVERSO da 'run:ended', che è riservato alla morte
   *  e fa scattare il rallentatore in main.ts. Serve ai consumatori del bus
   *  (l'audio, per spegnere il rombo della valanga) per sapere che la run è
   *  finita anche quando non c'è stata una morte. */
  'run:stopped': Record<string, never>;
  'pickup:collected': { kind: PickupKind; charge: number };
  'obstacle:hit': {
    kind: ObstacleKind;
    outcome: 'death' | 'forgiven' | 'smashed';
    branch: Branch;
    z: number;
  };
  'size:changed': { size: number; previous: number };
  'avalanche:triggered': { size: number };
  'avalanche:ending': Record<string, never>;
  'avalanche:ended': Record<string, never>;
  /** Un bivio è appena diventato visibile all'orizzonte del giocatore. */
  'fork:appeared': { richBranch: 'left' | 'right' };
  /** Il giocatore ha scelto (o cambiato scelta) un ramo prima del punto di non ritorno. */
  'fork:chosen': { side: 'left' | 'right' };
  /** Il bivio è stato risolto (dal giocatore o imposto): il ramo `side` è ora solido. */
  'fork:resolved': { side: 'left' | 'right' };
  'buff:gained': { kind: BuffKind };
  'buff:expired': { kind: BuffKind };
  'shield:consumed': Record<string, never>;
}

export type EventName = keyof GameEvents;

export interface EventBus {
  /** Restituisce una funzione di disiscrizione. */
  on<K extends EventName>(name: K, handler: (payload: GameEvents[K]) => void): () => void;
  emit<K extends EventName>(name: K, payload: GameEvents[K]): void;
  clear(): void;
}

/**
 * Firma interna, volutamente opaca: la mappa non può essere tipizzata per chiave
 * senza perdere la relazione nome→payload dell'API pubblica.
 */
type AnyHandler = (payload: unknown) => void;

export function createEventBus(): EventBus {
  const handlers = new Map<EventName, Set<AnyHandler>>();

  const on = <K extends EventName>(
    name: K,
    handler: (payload: GameEvents[K]) => void,
  ): (() => void) => {
    const wrapped = handler as AnyHandler;
    let set = handlers.get(name);
    if (set === undefined) {
      set = new Set<AnyHandler>();
      handlers.set(name, set);
    }
    const target = set;
    target.add(wrapped);
    return (): void => {
      target.delete(wrapped);
    };
  };

  const emit = <K extends EventName>(name: K, payload: GameEvents[K]): void => {
    const set = handlers.get(name);
    if (set === undefined) {
      return;
    }
    // Si itera il Set direttamente (nessuna copia, nessuna allocazione nel loop).
    // Un handler che lancia viene isolato: gli altri devono comunque ricevere l'evento.
    for (const handler of set) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[events] handler failed for "${name}"`, error);
      }
    }
  };

  const clear = (): void => {
    handlers.clear();
  };

  return { on, emit, clear };
}
```

Elimina i due file della geometria a corsie:

```bash
git rm src/game/lanes.ts src/game/lanes.test.ts
```

- [ ] **Step 4: Verifica**

Comando: `npm run test:run -- src/game/types.test.ts src/game/config.test.ts`

Atteso: PASS, tutti i casi.

Verifica che non resti alcun riferimento a `./lanes` fuori dai file già
elencati nella tabella sopra (conferma che l'inventario è esatto, non
approssimativo):

Comando: `grep -rln "\./lanes\|\.\./game/lanes" src`

Atteso: esattamente gli 8 file di sorgente della tabella (`collisions.ts`,
`player.ts`, `spawner.ts`, `entities-view.ts`, `main.ts`) più `player.test.ts` e
`collisions.test.ts` — nessun altro, e nessuno dei due file appena cancellati
(non esistono più, quindi il comando non li troverà).

Ora la dichiarazione onesta dello stato globale:

Comando: `npm run typecheck`

Atteso: FAIL, con errori di risoluzione modulo (`Cannot find module './lanes'`
o equivalente) e di tipo (`Property 'lane' does not exist`, `Property 'width'
does not exist`, `Object literal may only specify known properties`) in
esattamente i 9 file di sorgente e i 10 file di test elencati nella tabella
sopra. Nessun errore in `src/game/types.ts`, `src/game/config.ts`,
`src/core/events.ts`, `src/game/types.test.ts`, `src/game/config.test.ts`, né in
alcun file non citato in tabella (`src/game/avalanche.ts`, `src/game/score.ts`,
`src/game/world.ts`, `src/game/flow.ts`, `src/core/loop.ts`,
`src/core/state-machine.ts`, `src/render/scene.ts`, `src/render/models.ts`,
`src/render/camera-rig.ts`, `src/render/voxel-pool.ts`, `src/render/debris.ts`,
`src/render/backdrop.ts`, `src/render/webgl-support.ts`,
`src/render/perf-monitor.ts`, `src/ui/*`, `src/audio/audio.ts` — questi non
toccano corsie né i kind rimossi, e restano verdi).

Comando: `npm run test:run`

Atteso: FAIL. I file di test elencati in tabella falliscono (alcuni già in fase
di raccolta, per l'import da `./lanes` che non risolve); tutti gli altri file di
test (inclusi `types.test.ts` e `config.test.ts` di questo task) restano verdi.
Questo è lo stato intenzionale fino alla fine del Task 7: **non** è un
regression da correggere qui.

- [ ] **Step 5: Commit**

```bash
git add src/game/types.ts src/game/config.ts src/core/events.ts \
  src/game/types.test.ts src/game/config.test.ts
git commit -m "feat(game): redesign types and config for the single-path v2, drop lanes"
```

---

### Task 2: `src/game/path.ts` — il tracciato e i bivi

Il cuore della v2. Implementa lo stato del percorso e la macchina a fasi del
bivio: `none → approaching → committed → realigning → none`. È un modulo NUOVO,
senza consumatori ancora esistenti nel resto del codice: i suoi test si eseguono
e passano già da soli, in isolamento, anche se il resto della suite resta rosso
per le ragioni lasciate dal Task 1 (tabella riportata lì; nessuna riga di quella
tabella cambia stato in questo task, perché nessuno dei file elencati importa
`path.ts`).

**Nota di design sulle 4 fasi.** `forkZ` rappresenta sempre "distanza dalla
biforcazione", con un segno: positiva prima di raggiungerla, negativa dopo.
Questo evita di dover aggiungere un campo-timer che il contratto non prevede:
`'approaching'` è il tratto da `previewZ` a `commitZ` (bivio visibile, scelta
libera e reversibile); `'committed'` è l'ultimo tratto, da `commitZ` a 0 (la
scelta è bloccata, il ramo è già solido, ma il mondo non ha ancora iniziato a
scorrere lateralmente: il giocatore sta ancora correndo sul ramo offset);
`'realigning'` inizia quando `forkZ` attraversa lo zero (il giocatore è
fisicamente al bivio) e dura finché la distanza percorsa da quel punto non
raggiunge `speed * realignSeconds`, cioè finché non converte in "tempo" tramite
la velocità corrente — non serve un secondo campo per il tempo, perché a
velocità nota (passata a ogni chiamata di `updatePath`) distanza e tempo sono
intercambiabili.

**Nota su `chooseBranch` e l'evento `'fork:chosen'`.** La firma di
`chooseBranch` nel contratto NON riceve il bus (`chooseBranch(path, side):
boolean`), quindi non può emettere eventi. `'fork:chosen'` resta un evento
legittimo di `GameEvents` (aggiunto al Task 1) ma la sua emissione è
responsabilità del CHIAMANTE di `chooseBranch` (l'orchestratore `game.ts`, in un
task successivo, quando `handleAction` traduce `CHOOSE_LEFT`/`CHOOSE_RIGHT` in
una chiamata a `chooseBranch` che restituisce `true`). `updatePath`, che il bus
lo riceve, emette invece `'fork:appeared'` e `'fork:resolved'` in prima persona,
perché sono conseguenze dirette del solo avanzare del tempo/della distanza, non
di un'azione del giocatore.

**Files:**
- Create: `src/game/path.ts`
- Test: `src/game/path.test.ts`

**Interfaces:**
- Consumes:
  - `export const CONFIG` da `./config` (Task 1): `path.branchSeparation`,
    `path.previewZ`, `path.commitZ`, `path.realignSeconds`, `path.minGap`,
    `path.gapPerSpeed`, `world.startSpeed`.
  - `export type Branch` da `./types` (Task 1).
  - `export interface Rng` da `../core/rng` (esistente, invariato).
  - `export interface EventBus` da `../core/events` (Task 1, con i nuovi eventi
    `'fork:appeared'`, `'fork:resolved'`).
  - `export function speedAt(distance: number): number` da `./speed`
    (esistente, invariato: solo nel test, per simulare una velocità crescente
    realistica).
- Produces:
  - `export type ForkPhase = 'none' | 'approaching' | 'committed' | 'realigning';`
  - `export interface PathState { phase: ForkPhase; forkZ: number; choice: 'left' | 'right' | null; richBranch: 'left' | 'right'; activeBranch: Branch; offsetX: number; nextForkIn: number; }`
  - `export function createPath(): PathState;`
  - `export function updatePath(path: PathState, travelled: number, speed: number, rng: Rng, bus: EventBus): void;`
  - `export function chooseBranch(path: PathState, side: 'left' | 'right'): boolean;`
  - `export function branchIsSolid(path: PathState, branch: Branch): boolean;`
  - `export function branchOffsetX(path: PathState, branch: Branch): number;`

- [ ] **Step 1: Scrivi il test che fallisce**

`src/game/path.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../core/events';
import type { EventBus, GameEvents } from '../core/events';
import { createRng } from '../core/rng';
import { CONFIG } from './config';
import {
  branchIsSolid,
  branchOffsetX,
  chooseBranch,
  createPath,
  updatePath,
} from './path';
import type { PathState } from './path';
import { speedAt } from './speed';

const STEP = 1 / 60;

/** Bus di test: accumula i payload di un evento, nell'ordine di emissione. */
function recordedBus<K extends keyof GameEvents>(
  name: K,
): { bus: EventBus; payloads: GameEvents[K][] } {
  const bus = createEventBus();
  const payloads: GameEvents[K][] = [];
  bus.on(name, (payload) => payloads.push(payload));
  return { bus, payloads };
}

/** Avanza il percorso di `distance` unità a velocità costante, a passi di STEP
 *  (l'ultimo passo può essere più corto, per chiudere esattamente su `distance`). */
function travel(
  path: PathState,
  distance: number,
  speed: number,
  rng: ReturnType<typeof createRng>,
  bus: EventBus,
): void {
  let remaining = distance;
  while (remaining > 0) {
    const step = Math.min(speed * STEP, remaining);
    updatePath(path, step, speed, rng, bus);
    remaining -= step;
  }
}

describe('createPath', () => {
  it('parte senza bivio, sul ramo main, offset zero', () => {
    const path = createPath();
    expect(path.phase).toBe('none');
    expect(path.activeBranch).toBe('main');
    expect(path.offsetX).toBe(0);
    expect(path.choice).toBeNull();
  });
});

describe('updatePath — comparsa del bivio', () => {
  it('non compare prima della distanza attesa', () => {
    const { bus } = recordedBus('fork:appeared');
    const path = createPath();
    const rng = createRng(1);
    travel(path, CONFIG.path.minGap - 1, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('none');
  });

  it('compare dopo la distanza attesa', () => {
    const { bus, payloads } = recordedBus('fork:appeared');
    const path = createPath();
    const rng = createRng(1);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('approaching');
    expect(payloads.length).toBe(1);
    expect(['left', 'right']).toContain(payloads[0]?.richBranch);
  });

  it('emette fork:appeared una sola volta per bivio, dalla comparsa alla chiusura', () => {
    const { bus, payloads } = recordedBus('fork:appeared');
    const path = createPath();
    const rng = createRng(1);
    const totalToClose =
      CONFIG.path.minGap +
      CONFIG.path.previewZ +
      CONFIG.path.realignSeconds * CONFIG.world.startSpeed +
      5;
    travel(path, totalToClose, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('none');
    expect(payloads.length).toBe(1);
  });
});

describe('chooseBranch', () => {
  it('prima del punto di non ritorno cambia la scelta, anche più volte', () => {
    const bus = createEventBus();
    const path = createPath();
    const rng = createRng(1);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('approaching');

    expect(chooseBranch(path, 'left')).toBe(true);
    expect(path.choice).toBe('left');

    expect(chooseBranch(path, 'right')).toBe(true);
    expect(path.choice).toBe('right');

    expect(chooseBranch(path, 'left')).toBe(true);
    expect(path.choice).toBe('left');
  });

  it('dopo il punto di non ritorno restituisce false e non cambia più nulla', () => {
    const bus = createEventBus();
    const path = createPath();
    const rng = createRng(1);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    chooseBranch(path, 'left');
    travel(
      path,
      CONFIG.path.previewZ - CONFIG.path.commitZ + 1,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );
    expect(path.phase).not.toBe('approaching');

    const lockedChoice = path.choice;
    expect(chooseBranch(path, lockedChoice === 'left' ? 'right' : 'left')).toBe(false);
    expect(path.choice).toBe(lockedChoice);
  });

  it('restituisce false se non c-è alcun bivio in corso', () => {
    const path = createPath();
    expect(chooseBranch(path, 'left')).toBe(false);
    expect(path.choice).toBeNull();
  });
});

describe('senza scelta', () => {
  it('al punto di non ritorno impone il ramo NON ricco', () => {
    const { bus, payloads } = recordedBus('fork:resolved');
    const path = createPath();
    const rng = createRng(7);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    const rich = path.richBranch;
    const expectedChoice = rich === 'left' ? 'right' : 'left';

    travel(
      path,
      CONFIG.path.previewZ - CONFIG.path.commitZ + 1,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );

    expect(path.choice).toBe(expectedChoice);
    expect(path.activeBranch).toBe(expectedChoice);
    expect(payloads.length).toBe(1);
    expect(payloads[0]?.side).toBe(expectedChoice);
  });
});

describe('branchIsSolid', () => {
  it('main è sempre solido, in ogni fase', () => {
    const bus = createEventBus();
    const path = createPath();
    expect(branchIsSolid(path, 'main')).toBe(true);

    const rng = createRng(1);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    expect(branchIsSolid(path, 'main')).toBe(true);
  });

  it('durante approaching nessun ramo laterale è solido', () => {
    const bus = createEventBus();
    const path = createPath();
    const rng = createRng(1);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase).toBe('approaching');
    expect(branchIsSolid(path, 'left')).toBe(false);
    expect(branchIsSolid(path, 'right')).toBe(false);
  });

  it('dopo il commit solo il ramo scelto è solido', () => {
    const bus = createEventBus();
    const path = createPath();
    const rng = createRng(1);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    chooseBranch(path, 'left');
    travel(
      path,
      CONFIG.path.previewZ - CONFIG.path.commitZ + 1,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );

    expect(path.activeBranch).toBe('left');
    expect(branchIsSolid(path, 'left')).toBe(true);
    expect(branchIsSolid(path, 'right')).toBe(false);
  });
});

describe('riallineamento', () => {
  it('finisce sempre con offsetX esattamente 0, phase none, activeBranch main', () => {
    const bus = createEventBus();
    const path = createPath();
    const rng = createRng(3);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    chooseBranch(path, 'right');
    travel(
      path,
      CONFIG.path.previewZ + CONFIG.path.realignSeconds * CONFIG.world.startSpeed + 5,
      CONFIG.world.startSpeed,
      rng,
      bus,
    );

    expect(path.phase).toBe('none');
    expect(path.offsetX).toBe(0);
    expect(path.activeBranch).toBe('main');
  });

  it('durante il riallineamento la posizione a schermo del ramo scelto converge al centro monotonamente', () => {
    const bus = createEventBus();
    const path = createPath();
    const rng = createRng(3);
    travel(path, CONFIG.path.minGap + 1, CONFIG.world.startSpeed, rng, bus);
    chooseBranch(path, 'right');
    travel(path, CONFIG.path.previewZ, CONFIG.world.startSpeed, rng, bus);
    expect(path.phase === 'committed' || path.phase === 'realigning').toBe(true);

    // "Posizione a schermo del ramo scelto" = branchOffsetX('right') + offsetX:
    // parte da +branchSeparation (ramo ancora tutto spostato) e deve scendere
    // verso 0 senza mai risalire. Il confronto vale solo MENTRE il ramo è
    // ancora 'right': appena il riallineamento finisce, activeBranch torna a
    // 'main' e offsetX viene azzerato nello stesso frame (fine di un
    // riallineamento, non un nuovo movimento da misurare), quindi il loop si
    // ferma lì e verifica l'esito finale a parte.
    const chosenOffset = CONFIG.path.branchSeparation; // branchOffsetX(path, 'right')
    let previous = Math.abs(chosenOffset + path.offsetX);
    for (let i = 0; i < 60; i++) {
      updatePath(path, CONFIG.world.startSpeed * STEP, CONFIG.world.startSpeed, rng, bus);
      if (path.phase === 'none') break;
      const current = Math.abs(chosenOffset + path.offsetX);
      expect(current).toBeLessThanOrEqual(previous + 1e-9);
      previous = current;
    }
    expect(path.phase).toBe('none');
    expect(path.offsetX).toBe(0);
  });
});

describe('simulazione lunga', () => {
  it('a 60 s con velocità crescente, i bivi non si sovrappongono mai e si chiudono sempre', () => {
    const bus = createEventBus();
    let forkOpen = false;
    let appearedCount = 0;
    let closedCount = 0;
    let lastCloseDistance = 0;
    const gapsSinceLastClose: number[] = [];

    bus.on('fork:appeared', () => {
      // Nessuna sovrapposizione possibile per costruzione (un solo PathState,
      // una sola fase alla volta), ma lo si verifica comunque a runtime.
      expect(forkOpen).toBe(false);
      forkOpen = true;
      appearedCount += 1;
    });

    const path = createPath();
    const rng = createRng(42);
    let distance = 0;
    const steps = Math.round(60 / STEP);

    for (let i = 0; i < steps; i++) {
      const speed = speedAt(distance);
      const travelled = speed * STEP;
      const wasNone = path.phase === 'none';
      updatePath(path, travelled, speed, rng, bus);
      distance += travelled;

      if (!wasNone && path.phase === 'none' && path.offsetX === 0) {
        expect(forkOpen).toBe(true);
        forkOpen = false;
        closedCount += 1;
        gapsSinceLastClose.push(distance - lastCloseDistance);
        lastCloseDistance = distance;
      }
    }

    // Con la curva di velocità di CONFIG.world (18→40 u/s) e gapPerSpeed=6, il
    // costo di un bivio (minGap + gapPerSpeed*speed + previewZ + realignSeconds*speed)
    // cresce con la velocità: in 60 s simulati un seed qualsiasi ne produce
    // stabilmente 4 (verificato su più seed). La soglia resta comunque sotto
    // quel valore, per non legare il test a un numero magico ottenuto per tentativi.
    expect(appearedCount).toBeGreaterThanOrEqual(3);
    // Ogni bivio si chiude, salvo eventualmente l'ultimo se la simulazione
    // finisce a metà del suo riallineamento.
    expect(closedCount).toBeGreaterThanOrEqual(appearedCount - 1);
    for (const gap of gapsSinceLastClose) {
      expect(gap).toBeGreaterThanOrEqual(CONFIG.path.minGap - 1);
    }
  });
});

describe('determinismo', () => {
  it('a parità di seed la sequenza di richBranch è identica', () => {
    function run(seed: number): Array<'left' | 'right'> {
      const bus = createEventBus();
      const sequence: Array<'left' | 'right'> = [];
      bus.on('fork:appeared', (payload) => sequence.push(payload.richBranch));

      const path = createPath();
      const rng = createRng(seed);
      let distance = 0;
      const steps = Math.round(40 / STEP);
      for (let i = 0; i < steps; i++) {
        const speed = speedAt(distance);
        const travelled = speed * STEP;
        updatePath(path, travelled, speed, rng, bus);
        distance += travelled;
      }
      return sequence;
    }

    const first = run(123);
    expect(first.length).toBeGreaterThan(0);
    expect(run(123)).toEqual(first);
  });
});

describe('branchOffsetX', () => {
  it('è simmetrico e nullo per il ramo main', () => {
    const path = createPath();
    expect(branchOffsetX(path, 'main')).toBe(0);
    expect(branchOffsetX(path, 'left')).toBe(-CONFIG.path.branchSeparation);
    expect(branchOffsetX(path, 'right')).toBe(CONFIG.path.branchSeparation);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/game/path.test.ts`

Atteso: FAIL con `Failed to resolve import "./path"` (il modulo non esiste ancora).

- [ ] **Step 3: Implementa il minimo necessario**

`src/game/path.ts`:

```ts
import type { EventBus } from '../core/events';
import type { Rng } from '../core/rng';
import { CONFIG } from './config';
import type { Branch } from './types';

export type ForkPhase = 'none' | 'approaching' | 'committed' | 'realigning';

export interface PathState {
  phase: ForkPhase;
  /** Distanza della biforcazione dal giocatore. Valida se phase !== 'none':
   *  positiva prima di raggiungerla, negativa (distanza già percorsa) dopo. */
  forkZ: number;
  /** Ramo verso cui il giocatore è orientato: null finché non sceglie. */
  choice: 'left' | 'right' | null;
  /** Quale dei due rami è quello ricco (più fiocchi e buff, più ostacoli). */
  richBranch: 'left' | 'right';
  /** Ramo solido: 'main' finché non ci si impegna, poi il ramo scelto. */
  activeBranch: Branch;
  /** Offset laterale corrente del mondo, in unità. 0 = tracciato dritto. */
  offsetX: number;
  /** Distanza ancora da percorrere prima del prossimo bivio. */
  nextForkIn: number;
}

const SIDES: readonly ('left' | 'right')[] = ['left', 'right'];

export function createPath(): PathState {
  return {
    phase: 'none',
    forkZ: 0,
    choice: null,
    // Placeholder senza significato: sovrascritto non appena appare il primo
    // bivio (vedi il commento su forkZ qui sopra: "valido se phase !== 'none'").
    richBranch: 'left',
    activeBranch: 'main',
    offsetX: 0,
    // Prima del primissimo bivio non esiste ancora una velocità "di prima" da
    // usare nella formula gapPerSpeed: si parte dal solo margine minimo, come
    // se la run fosse appena ripartita da un riallineamento a velocità nulla.
    nextForkIn: CONFIG.path.minGap,
  };
}

/** Offset laterale a cui va disegnato un ramo, in unità di mondo. Pura
 *  geometria del bivio: non dipende dalla fase corrente. */
export function branchOffsetX(_path: PathState, branch: Branch): number {
  if (branch === 'left') return -CONFIG.path.branchSeparation;
  if (branch === 'right') return CONFIG.path.branchSeparation;
  return 0;
}

/** true se le entità di quel ramo sono solide (collidono e si raccolgono). */
export function branchIsSolid(path: PathState, branch: Branch): boolean {
  if (branch === 'main') return true;
  return path.activeBranch === branch;
}

/**
 * Registra o cambia la scelta. Restituisce false se non c'è un bivio
 * scegliibile (nessun bivio in corso, o punto di non ritorno già superato).
 * Non emette eventi: la firma non riceve il bus, quindi 'fork:chosen' è
 * responsabilità del chiamante (l'orchestratore, task successivo), che lo
 * emette quando questa funzione restituisce true.
 */
export function chooseBranch(path: PathState, side: 'left' | 'right'): boolean {
  if (path.phase !== 'approaching') return false;
  path.choice = side;
  return true;
}

/** Avanza il percorso. `travelled` è la distanza percorsa in questo frame. */
export function updatePath(
  path: PathState,
  travelled: number,
  speed: number,
  rng: Rng,
  bus: EventBus,
): void {
  switch (path.phase) {
    case 'none': {
      path.nextForkIn -= travelled;
      if (path.nextForkIn > 0) return;
      // L'eccesso di questo passo appartiene già al bivio appena nato: senza
      // scalarlo da previewZ, ogni bivio nascerebbe un po' più lontano di
      // quanto dovrebbe, un errore che si accumulerebbe run dopo run.
      const overshoot = -path.nextForkIn;
      path.phase = 'approaching';
      path.forkZ = CONFIG.path.previewZ - overshoot;
      path.choice = null;
      path.richBranch = rng.pick(SIDES);
      bus.emit('fork:appeared', { richBranch: path.richBranch });
      return;
    }
    case 'approaching': {
      path.forkZ -= travelled;
      if (path.forkZ > CONFIG.path.commitZ) return;
      // Punto di non ritorno: chi non ha scelto imbocca il ramo più sgombro,
      // cioè quello NON ricco. L'indecisione costa il premio, mai la corsa.
      const resolved = path.choice ?? (path.richBranch === 'left' ? 'right' : 'left');
      path.choice = resolved;
      path.activeBranch = resolved;
      path.phase = 'committed';
      bus.emit('fork:resolved', { side: resolved });
      return;
    }
    case 'committed': {
      // Ultimo tratto prima della biforcazione vera e propria: il ramo è già
      // solido, ma il mondo non ha ancora iniziato a scorrere lateralmente.
      path.forkZ -= travelled;
      if (path.forkZ > 0) return;
      path.phase = 'realigning';
      return;
    }
    case 'realigning': {
      // Da qui forkZ scende sotto zero: il suo valore assoluto è la distanza
      // percorsa OLTRE la biforcazione, che a velocità nota si converte in
      // "quanto tempo è passato" senza bisogno di un campo a parte.
      path.forkZ -= travelled;
      const distancePast = -path.forkZ;
      const realignDistance = Math.max(1e-6, speed * CONFIG.path.realignSeconds);
      const t = Math.min(1, distancePast / realignDistance);
      path.offsetX = -branchOffsetX(path, path.activeBranch) * t;
      if (t >= 1) {
        path.phase = 'none';
        path.offsetX = 0;
        path.activeBranch = 'main';
        path.choice = null;
        path.forkZ = 0;
        path.nextForkIn = CONFIG.path.minGap + CONFIG.path.gapPerSpeed * speed;
      }
      return;
    }
  }
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run -- src/game/path.test.ts`

Atteso: PASS, tutti i casi (compresi i due test statistici: 60 s simulati e il
confronto a parità di seed).

Verifica anche i tipi del solo modulo nuovo (il resto della suite resta rosso
per l'inventario del Task 1, invariato da questo task):
`npx tsc --noEmit -p tsconfig.json` continuerà a segnalare gli stessi errori già
elencati al Task 1, e NESSUNO in più su `src/game/path.ts` o
`src/game/path.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/game/path.ts src/game/path.test.ts
git commit -m "feat(game): add forking path state machine (path.ts)"
```

---

### Task 3: `src/game/player.ts` — salto, scivolata, tuffo

Riscrive il giocatore senza corsie. Il file e il test vengono sostituiti per
intero: non c'è più `lane`, `x`, `laneFromX`, `laneChangeT`, `moveLane`, né
`slamming`/`slamTimer`/`slam` (rinominati in `sliding`/`slideTimer`/`slide`, con
comportamento nuovo in aria).

**Estensione del contratto: `jumpTimer`.** Il campo è già nell'interfaccia data
dal contratto, ma il contratto non ne descrive l'uso: non guida l'atterraggio
(che resta legato a `y <= 0`, l'unico modo per cui un tuffo con gravità
maggiorata atterra prima del previsto senza dover ricalcolare una parabola
diversa a metà volo), ma accumula i secondi trascorsi dall'inizio del salto in
corso, azzerato all'atterraggio. Serve a chi consuma lo stato dall'esterno (la
vista, per animare l'inclinazione della mucca a mezz'aria, task di rendering)
senza dover ricavare il tempo trascorso da `vy`.

**Scelta di design dichiarata: un salto durante la scivolata la interrompe.**
Stesso comportamento già presente in v1 per `slam` → `jump` (vedi
`docs/superpowers/plans/2026-08-16-rolling-cows.md`, Task 9): `jump()` azzera
sempre `sliding`/`slideTimer`, sia a terra sia — qui è la parte nuova — quando
chiamato mentre si sta ancora completando l'atterraggio di un tuffo. Dà al
giocatore una via d'uscita immediata se ha scivolato per errore davanti a un
ostacolo a terra invece che sospeso. Testata esplicitamente sotto.

**Cosa NON cambia per il resto del progetto.** `src/game/game.ts` continua a
chiamare `moveLane`, `jump(game.player)` e `slam(game.player)` sui vecchi nomi:
resta nell'elenco dei file rotti del Task 1, con due aggiunte a quella riga
della tabella — `moveLane` ora non è solo "una funzione che sparirà", è
sparita per davvero, e `slam` non esiste più affatto (si chiama `slide`) — nessun
altro file della tabella del Task 1 cambia stato. Il progetto torna verde solo
alla fine del Task 7.

**Files:**
- Modify: `src/game/player.ts`
- Test: `src/game/player.test.ts` (riscritto)

**Interfaces:**
- Consumes:
  - `export const CONFIG` da `./config` (Task 1): `player.jumpSeconds`,
    `player.jumpHeight`, `player.slideSeconds`, `player.diveGravityMultiplier`.
- Produces:
  - `export interface PlayerState { y: number; vy: number; airborne: boolean; sliding: boolean; slideTimer: number; jumpTimer: number; }`
  - `export function createPlayer(): PlayerState;`
  - `export function jump(player: PlayerState): void;`
  - `export function slide(player: PlayerState): void;`
  - `export function updatePlayer(player: PlayerState, dt: number): void;`

- [ ] **Step 1: Scrivi il test che fallisce**

`src/game/player.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { createPlayer, jump, slide, updatePlayer } from './player';
import type { PlayerState } from './player';

const STEP = 1 / 60;
const { jumpSeconds, jumpHeight, slideSeconds } = CONFIG.player;

/** Simula il volo e restituisce il tempo di atterraggio e la quota massima. */
function flight(player: PlayerState): { landedAt: number; maxY: number; maxAt: number } {
  let elapsed = 0;
  let maxY = 0;
  let maxAt = 0;
  while (player.airborne && elapsed < 5) {
    updatePlayer(player, STEP);
    elapsed += STEP;
    if (player.y > maxY) {
      maxY = player.y;
      maxAt = elapsed;
    }
  }
  return { landedAt: elapsed, maxY, maxAt };
}

describe('createPlayer', () => {
  it('parte a terra, senza scivolata né volo', () => {
    const player = createPlayer();
    expect(player.y).toBe(0);
    expect(player.vy).toBe(0);
    expect(player.airborne).toBe(false);
    expect(player.sliding).toBe(false);
    expect(player.slideTimer).toBe(0);
    expect(player.jumpTimer).toBe(0);
  });
});

describe('jump', () => {
  it('descrive una parabola che culmina vicino a jumpHeight a metà volo', () => {
    const player = createPlayer();
    jump(player);
    expect(player.airborne).toBe(true);

    const { maxY, maxAt } = flight(player);
    expect(maxY).toBeGreaterThan(jumpHeight - 0.05);
    expect(maxY).toBeLessThanOrEqual(jumpHeight + 1e-6);
    expect(Math.abs(maxAt - jumpSeconds / 2)).toBeLessThan(0.05);
  });

  it('atterra dopo jumpSeconds', () => {
    const player = createPlayer();
    jump(player);
    const { landedAt } = flight(player);

    expect(Math.abs(landedAt - jumpSeconds)).toBeLessThanOrEqual(STEP);
    expect(player.y).toBe(0);
    expect(player.vy).toBe(0);
    expect(player.airborne).toBe(false);
  });

  it('viene ignorato se si è già in aria', () => {
    const player = createPlayer();
    jump(player);
    for (let i = 0; i < 10; i++) updatePlayer(player, STEP);
    const yBefore = player.y;
    const vyBefore = player.vy;

    jump(player);
    expect(player.y).toBe(yBefore);
    expect(player.vy).toBe(vyBefore);
  });
});

describe('slide a terra', () => {
  it('dura slideSeconds e poi si spegne', () => {
    const player = createPlayer();
    slide(player);
    expect(player.sliding).toBe(true);
    expect(player.slideTimer).toBeCloseTo(slideSeconds, 10);

    updatePlayer(player, slideSeconds / 2);
    expect(player.sliding).toBe(true);

    updatePlayer(player, slideSeconds / 2 + STEP);
    expect(player.sliding).toBe(false);
    expect(player.slideTimer).toBe(0);
  });

  it('può essere ri-avviata a fine durata', () => {
    const player = createPlayer();
    slide(player);
    updatePlayer(player, slideSeconds + STEP);
    expect(player.sliding).toBe(false);

    slide(player);
    expect(player.sliding).toBe(true);
    expect(player.slideTimer).toBeCloseTo(slideSeconds, 10);
  });
});

describe('slide in aria (tuffo)', () => {
  it('accelera la caduta rispetto a un salto normale', () => {
    const plain = createPlayer();
    jump(plain);
    const plainFlight = flight(plain);

    const diving = createPlayer();
    jump(diving);
    updatePlayer(diving, STEP);
    slide(diving);
    expect(diving.sliding).toBe(true);
    const diveFlight = flight(diving);

    expect(diveFlight.landedAt + STEP).toBeLessThan(plainFlight.landedAt);
  });

  it('all-atterraggio il giocatore risulta in scivolata', () => {
    const player = createPlayer();
    jump(player);
    updatePlayer(player, STEP);
    slide(player);

    flight(player);

    expect(player.airborne).toBe(false);
    expect(player.y).toBe(0);
    expect(player.sliding).toBe(true);
    expect(player.slideTimer).toBeCloseTo(slideSeconds, 10);
  });
});

describe('salto durante la scivolata', () => {
  it('è possibile e interrompe la scivolata', () => {
    // Scelta di design (vedi commento del task): come già in v1 per lo slam a
    // terra, saltare durante una scivolata la interrompe subito invece di
    // restare bloccati a terra finché non scade slideTimer.
    const player = createPlayer();
    slide(player);
    expect(player.sliding).toBe(true);

    jump(player);

    expect(player.airborne).toBe(true);
    expect(player.sliding).toBe(false);
    expect(player.slideTimer).toBe(0);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/game/player.test.ts`

Atteso: FAIL. `createPlayer()` non ha i campi `sliding`/`slideTimer`/`jumpTimer`
(la versione attuale ha `lane`/`x`/`slamming`/`slamTimer`), e le funzioni
`slide` non esiste ancora (esiste solo `slam`, con firma e semantica diverse).

- [ ] **Step 3: Implementa il minimo necessario**

`src/game/player.ts`:

```ts
import { CONFIG } from './config';

/** Velocità iniziale e gravità del salto scriptato. Da y(t) = v0*t - g*t^2/2, per
 *  durare T = jumpSeconds e culminare a h = jumpHeight servono v0 = 4h/T e g = 8h/T^2. */
const JUMP_SPEED = (4 * CONFIG.player.jumpHeight) / CONFIG.player.jumpSeconds;
const JUMP_GRAVITY =
  (8 * CONFIG.player.jumpHeight) / (CONFIG.player.jumpSeconds * CONFIG.player.jumpSeconds);

export interface PlayerState {
  y: number;
  vy: number;
  airborne: boolean;
  sliding: boolean;
  slideTimer: number;
  /** Secondi trascorsi dall'inizio del salto in corso, azzerato
   *  all'atterraggio. Non guida l'atterraggio (che resta legato a `y`, così un
   *  tuffo con gravità maggiorata atterra prima del previsto senza bisogno di
   *  ricalcolare una parabola diversa a metà volo): è per chi consuma lo stato
   *  dall'esterno (la vista, per l'inclinazione a mezz'aria) senza doverlo
   *  ricavare da vy. */
  jumpTimer: number;
}

export function createPlayer(): PlayerState {
  return {
    y: 0,
    vy: 0,
    airborne: false,
    sliding: false,
    slideTimer: 0,
    jumpTimer: 0,
  };
}

export function jump(player: PlayerState): void {
  if (player.airborne) return;
  player.airborne = true;
  player.vy = JUMP_SPEED;
  player.jumpTimer = 0;
  // Un salto interrompe sempre una scivolata a terra in corso (stessa scelta
  // della v1 per slam→jump): dà al giocatore una via d'uscita immediata.
  player.sliding = false;
  player.slideTimer = 0;
}

/** A terra avvia (o ri-avvia) la scivolata; in aria fa il tuffo rapido, che
 *  atterra prima del previsto e prosegue automaticamente in scivolata. */
export function slide(player: PlayerState): void {
  if (player.airborne) {
    // Il tuffo non tocca slideTimer: la scivolata "vera", a terra, parte da
    // sola all'atterraggio (vedi updatePlayer). `sliding` funge qui da
    // marcatore "sto tuffandomi", letto sotto per la gravità maggiorata.
    player.sliding = true;
    return;
  }
  player.sliding = true;
  player.slideTimer = CONFIG.player.slideSeconds;
}

export function updatePlayer(player: PlayerState, dt: number): void {
  if (player.airborne) {
    player.jumpTimer += dt;
    const gravity = JUMP_GRAVITY * (player.sliding ? CONFIG.player.diveGravityMultiplier : 1);
    // Aggiornamento esatto per accelerazione costante: riproduce la parabola
    // analitica senza l'errore di integrazione dell'Eulero semplice.
    player.y += player.vy * dt - 0.5 * gravity * dt * dt;
    player.vy -= gravity * dt;
    // Soglia con epsilon: la somma in virgola mobile di decine di passi lascia
    // un residuo dell'ordine di 1e-15 invece di uno zero esatto all'apice
    // previsto, che ritarderebbe l'atterraggio di un intero step senza questa
    // tolleranza.
    if (player.y <= 1e-9) {
      const wasDiving = player.sliding;
      player.y = 0;
      player.vy = 0;
      player.airborne = false;
      player.jumpTimer = 0;
      if (wasDiving) {
        // Il tuffo che concatena salto e scivolata: è la manovra che permette
        // di superare ostacoli ravvicinati (vedi design doc, sezione Azioni).
        player.sliding = true;
        player.slideTimer = CONFIG.player.slideSeconds;
      } else {
        player.sliding = false;
      }
    }
    return;
  }

  if (player.slideTimer > 0) {
    player.slideTimer = Math.max(0, player.slideTimer - dt);
    if (player.slideTimer === 0) player.sliding = false;
  }
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run -- src/game/player.test.ts`

Atteso: PASS, tutti i casi. In particolare l'apice del salto entro 0,05 unità da
`jumpHeight`, l'atterraggio entro un passo da `jumpSeconds`, e l'atterraggio di
un tuffo strettamente più rapido di un salto normale.

Verifica anche i tipi del solo modulo toccato:
`npx tsc --noEmit -p tsconfig.json` continua a segnalare gli errori già noti su
`src/game/game.ts` (ora anche per `moveLane`/`slam` completamente assenti da
`./player`, non solo mal tipizzati) e sugli altri file della tabella del Task 1
— nessun errore nuovo, nessuno in meno fuori da `src/game/player.ts` e
`src/game/player.test.ts`, che sono invece puliti.

- [ ] **Step 5: Commit**

```bash
git add src/game/player.ts src/game/player.test.ts
git commit -m "feat(game): rewrite player for jump, slide and dive without lanes"
```

---

### Task 4: Collisioni a due assi (quota e distanza)

**Files:**
- Modify: `src/game/config.ts`
- Modify: `src/game/collisions.ts`
- Test: Modify `src/game/collisions.test.ts`

**Interfaces:**
- Consumes:
  - `export interface Entity { id: number; kind: EntityKind; category: 'obstacle' | 'pickup'; branch: Branch; z: number; y: number; alive: boolean; }`, `export type EntityKind`, `export function isOverhead(kind: EntityKind): boolean;` da `./types` (Task 1-3).
  - `export const CONFIG` da `./config`: `player.baseHeight`, `player.heightPerSize`, `player.depth`, `player.slideHeightRatio`, `player.jumpHeight`, `spawn.overheadY`, `avalanche.maxSize`, `collisions.entityBox` (quest'ultimo aggiornato in questo task, vedi Step 3).
- Produces:
  - `export interface Box { y: number; height: number; z: number; depth: number }`
  - `export const ENTITY_BOX: Record<EntityKind, { height: number; depth: number }>`
  - `export function playerBox(y: number, size: number, sliding: boolean): Box;`
  - `export function entityBox(entity: Entity): Box;`
  - `export function boxesOverlap(a: Box, b: Box): boolean;`

**Convenzioni del box.** `z` è un **centro**, `depth` la profondità **totale** (occupa
`z ± depth/2`); `y` è la **base** e `height` si estende verso l'alto (`y … y + height`).
L'asse X è sparito insieme alle corsie: la mucca è sempre al centro del ramo attivo
(vedi `path.ts`), quindi non esiste più un test laterale. Il contatto esatto non conta
come collisione: `boxesOverlap` usa confronti stretti.

**Invariante di design (il punto di questo task).** Con le costanti del contratto:
- in scivolata l'altezza della mucca è `(player.baseHeight + player.heightPerSize·size) ·
  player.slideHeightRatio`. Alla taglia massima (5) vale `(1.2 + 0.25·5) · 0.45 =
  1.1025`, sotto `spawn.overheadY` (1.6) di un margine di `0.4975`: **a qualunque
  taglia**, scivolando si passa sotto ogni ostacolo sospeso, perché la formula cresce
  con la taglia più lentamente del margine disponibile;
- al salto la base del box del giocatore è `player.jumpHeight` (3.2), indipendente
  dalla taglia (l'altezza si estende verso l'alto da lì). Il più alto ostacolo a terra
  è `rock` (1.4): margine `1.8`. **A qualunque taglia**, all'apice del salto si supera
  ogni ostacolo a terra.

Questi due fatti non sono un dettaglio implementativo: sono un vincolo di
bilanciamento che deve restare vero anche se in futuro qualcuno ritocca le altezze in
`config.ts`. Per questo lo Step 1 include un test che lo verifica esplicitamente per
ogni kind, iterando sulle taglie da 1 a 5, invece di fidarsi del calcolo a mano fatto
qui sopra.

- [ ] **Step 1: Scrivi il test che fallisce**

`src/game/collisions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { ENTITY_BOX, boxesOverlap, entityBox, playerBox } from './collisions';
import { isOverhead } from './types';
import type { Box } from './collisions';
import type { Entity, EntityKind } from './types';

const GROUND_KINDS: readonly EntityKind[] = ['rock', 'log', 'fence', 'crevasse'];
const OVERHEAD_KINDS: readonly EntityKind[] = ['branch', 'arch', 'cornice'];
const ALL_SIZES = [1, 2, 3, 4, 5];

function makeEntity(kind: EntityKind, z = 0, y = 0): Entity {
  const pickupKinds = new Set<EntityKind>(['snowflake', 'crystal', 'star', 'magnet', 'bell']);
  return {
    id: 1,
    kind,
    category: pickupKinds.has(kind) ? 'pickup' : 'obstacle',
    branch: 'main',
    z,
    y,
    alive: true,
  };
}

function box(y: number, height: number, z: number, depth: number): Box {
  return { y, height, z, depth };
}

describe('boxesOverlap', () => {
  it('rileva la sovrapposizione di due box coincidenti', () => {
    const a = box(0, 2, 0, 2);
    expect(boxesOverlap(a, box(0, 2, 0, 2))).toBe(true);
  });

  it('separa correttamente sull-asse Y', () => {
    const a = box(0, 2, 0, 2);
    expect(boxesOverlap(a, box(1.5, 2, 0, 2))).toBe(true);
    expect(boxesOverlap(a, box(2.5, 2, 0, 2))).toBe(false);
  });

  it('separa correttamente sull-asse Z', () => {
    const a = box(0, 2, 0, 2);
    expect(boxesOverlap(a, box(0, 2, 1.5, 2))).toBe(true);
    expect(boxesOverlap(a, box(0, 2, 3, 2))).toBe(false);
  });

  it('non considera collisione il contatto esatto sui bordi', () => {
    const a = box(0, 2, 0, 2);
    expect(boxesOverlap(a, box(2, 2, 0, 2))).toBe(false);
    expect(boxesOverlap(a, box(0, 2, 2, 2))).toBe(false);
  });
});

describe('playerBox', () => {
  it('cresce in altezza con la taglia', () => {
    const small = playerBox(0, 1, false);
    const big = playerBox(0, 5, false);
    expect(big.height).toBeGreaterThan(small.height);
    expect(small.height).toBeCloseTo(CONFIG.player.baseHeight + CONFIG.player.heightPerSize, 10);
    expect(small.depth).toBe(CONFIG.player.depth);
  });

  it('in scivolata riduce l-altezza esattamente di slideHeightRatio', () => {
    for (const size of ALL_SIZES) {
      const upright = playerBox(0, size, false);
      const sliding = playerBox(0, size, true);
      expect(sliding.height).toBeCloseTo(upright.height * CONFIG.player.slideHeightRatio, 10);
    }
  });
});

describe('entityBox', () => {
  it('usa le misure per kind di ENTITY_BOX', () => {
    const rock = entityBox(makeEntity('rock', 10));
    expect(rock.height).toBe(ENTITY_BOX.rock.height);
    expect(rock.depth).toBe(ENTITY_BOX.rock.depth);
    expect(rock.z).toBe(10);
  });

  it('definisce una misura per ogni kind', () => {
    const kinds: EntityKind[] = [
      'rock',
      'log',
      'fence',
      'crevasse',
      'branch',
      'arch',
      'cornice',
      'snowflake',
      'crystal',
      'star',
      'magnet',
      'bell',
    ];
    for (const kind of kinds) {
      expect(ENTITY_BOX[kind].height).toBeGreaterThan(0);
      expect(ENTITY_BOX[kind].depth).toBeGreaterThan(0);
    }
  });
});

describe('collisioni di gioco', () => {
  it('il crevasse colpisce solo chi è a terra, non chi sta saltando', () => {
    const crevasse = entityBox(makeEntity('crevasse'));
    expect(boxesOverlap(playerBox(0, 1, false), crevasse)).toBe(true);
    expect(boxesOverlap(playerBox(CONFIG.player.jumpHeight, 1, false), crevasse)).toBe(false);
  });

  it('isOverhead distingue esattamente i tre ostacoli sospesi dai quattro a terra', () => {
    for (const kind of OVERHEAD_KINDS) expect(isOverhead(kind)).toBe(true);
    for (const kind of GROUND_KINDS) expect(isOverhead(kind)).toBe(false);
  });
});

describe('invariante di design: l-azione richiesta resta sempre possibile', () => {
  it('in scivolata, a qualunque taglia da 1 a 5, si passa sotto OGNI ostacolo sospeso', () => {
    for (const kind of OVERHEAD_KINDS) {
      const overhead = entityBox(makeEntity(kind, 0, CONFIG.spawn.overheadY));
      for (const size of ALL_SIZES) {
        const sliding = playerBox(0, size, true);
        const clears = !boxesOverlap(sliding, overhead);
        expect(clears, `taglia ${size} dovrebbe passare sotto ${kind}`).toBe(true);
      }
    }
  });

  it('all-apice del salto, a qualunque taglia da 1 a 5, si supera OGNI ostacolo a terra', () => {
    for (const kind of GROUND_KINDS) {
      const ground = entityBox(makeEntity(kind, 0, 0));
      for (const size of ALL_SIZES) {
        const apex = playerBox(CONFIG.player.jumpHeight, size, false);
        const clears = !boxesOverlap(apex, ground);
        expect(clears, `taglia ${size} dovrebbe superare ${kind} al salto`).toBe(true);
      }
    }
  });

  it('il margine peggiore (taglia massima, scivolata) resta strettamente positivo', () => {
    const worstSlideTop = playerBox(0, CONFIG.avalanche.maxSize, true).height;
    expect(worstSlideTop).toBeLessThan(CONFIG.spawn.overheadY);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/game/collisions.test.ts`

Atteso: FAIL. Con `collisions.ts` ancora nella forma v1 (`playerBox` a 4 argomenti con
`x`, `ENTITY_BOX` senza i kind `log`/`arch`/`cornice`/`crystal`/`star`/`magnet`/`bell`),
i tipi non combaciano e i test sull'invariante falliscono per `ENTITY_BOX[kind]`
`undefined`.

- [ ] **Step 3: Implementa il minimo necessario**

Sostituisci in `src/game/config.ts` il blocco `collisions` (i Task 1-3 lo hanno
lasciato con i kind della v1, in attesa di questo task) con:

```ts
  collisions: {
    /** Ingombro verticale e in profondità di ogni tipo di entità. La X è sparita:
     *  senza corsie, le collisioni si riducono a distanza e quota (vedi
     *  game/collisions.ts). */
    entityBox: {
      /** Masso basso e tozzo: si scavalca solo saltando. */
      rock: { height: 1.4, depth: 1.4 },
      /** Tronco caduto: più basso del masso, stessa azione. */
      log: { height: 1.0, depth: 1.2 },
      /** Staccionata: bassa e sottile, il salto ci passa sopra comodamente. */
      fence: { height: 1.2, depth: 0.8 },
      /** Crepaccio: praticamente piatto, quindi colpisce solo chi è a terra;
       *  molto profondo, così va anticipato con il salto. */
      crevasse: { height: 0.1, depth: 4 },
      /** Ramo di abete sospeso: base a spawn.overheadY, spesso quanto una
       *  staccionata. */
      branch: { height: 1.2, depth: 0.8 },
      /** Arco di roccia sospeso: più alto del ramo. */
      arch: { height: 1.4, depth: 1.0 },
      /** Cornicione di ghiaccio sospeso: il più ingombrante dei tre. */
      cornice: { height: 1.6, depth: 1.2 },
      /** Fiocco di neve: piccolo, ma la raccolta è generosa. */
      snowflake: { height: 0.8, depth: 0.8 },
      /** Cristallo di ghiaccio: cubo di un metro. */
      crystal: { height: 1, depth: 1 },
      /** Stella: cubo di un metro. */
      star: { height: 1, depth: 1 },
      /** Calamita: cubo di un metro. */
      magnet: { height: 1, depth: 1 },
      /** Campanaccio: cubo di un metro. */
      bell: { height: 1, depth: 1 },
    },
  },
```

`src/game/collisions.ts`:

```ts
import { CONFIG } from './config';
import type { Entity, EntityKind } from './types';

/** AABB su due soli assi: quota e distanza. Niente più X: la mucca è sempre al
 *  centro del ramo attivo (vedi path.ts), quindi il test laterale è sparito insieme
 *  alle corsie. `y` è la base, `height` si estende verso l'alto (occupa
 *  [y, y+height]); `z` è il centro, `depth` la profondità totale (occupa
 *  [z-depth/2, z+depth/2]). */
export interface Box {
  y: number;
  height: number;
  z: number;
  depth: number;
}

/** Ingombro verticale e in profondità di ogni tipo di entità. */
export const ENTITY_BOX: Record<EntityKind, { height: number; depth: number }> =
  CONFIG.collisions.entityBox;

/** Box del giocatore. In scivolata l'altezza è ridotta di slideHeightRatio: è così
 *  che si passa sotto agli ostacoli sospesi, a qualunque taglia (vedi l'invariante
 *  di design documentata sopra il task). */
export function playerBox(y: number, size: number, sliding: boolean): Box {
  const { baseHeight, heightPerSize, depth, slideHeightRatio } = CONFIG.player;
  const height = baseHeight + heightPerSize * size;
  return {
    y,
    height: sliding ? height * slideHeightRatio : height,
    // Il giocatore è fermo sull'asse di scorrimento: è il mondo a muoversi.
    z: 0,
    depth,
  };
}

export function entityBox(entity: Entity): Box {
  const measures = ENTITY_BOX[entity.kind];
  return {
    y: entity.y,
    height: measures.height,
    z: entity.z,
    depth: measures.depth,
  };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  if (Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2) return false;
  if (a.y + a.height <= b.y) return false;
  if (b.y + b.height <= a.y) return false;
  return true;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`

Atteso: PASS su tutta la suite, incluse le tre asserzioni dell'invariante di design
per ogni kind e ogni taglia da 1 a 5.

Verifica anche i tipi: `npm run typecheck` → nessun errore. Se qualche altro file
importa ancora `playerBox`/`entityBox` con la vecchia firma a 4 argomenti (`x`
incluso) o riferisce kind rimossi (`tree`, `cabin`, `hay`, `cow` come ostacoli/
raccoglibili di gioco), aggiorna anche quel file e il suo test nello stesso commit:
il contratto vieta di lasciare la suite rossa a fine task.

- [ ] **Step 5: Commit**

```bash
git add src/game/config.ts src/game/collisions.ts src/game/collisions.test.ts
git commit -m "refactor(game): reduce collisions to two axes (height and distance)"
```

---

### Task 5: Generatore procedurale lungo un ramo

**Files:**
- Modify: `src/game/spawner.ts`
- Test: Modify `src/game/spawner.test.ts`

**Interfaces:**
- Consumes:
  - `export interface Rng { next(): number; int(minInclusive: number, maxExclusive: number): number; chance(p: number): boolean; pick<T>(items: readonly T[]): T; }` e `export function createRng(seed: number): Rng;` da `../core/rng`.
  - `export interface Entity { id: number; kind: EntityKind; category: 'obstacle' | 'pickup'; branch: Branch; z: number; y: number; alive: boolean; }`, `export type Branch`, `export type ObstacleKind`, `export type GroundObstacleKind`, `export type OverheadObstacleKind`, `export type BuffKind`, `export function isOverhead(kind: EntityKind): boolean;` da `./types` (Task 1-3).
  - `export const CONFIG` da `./config` (Task 1-3): `world.maxSpeed`, `player.jumpSeconds`, `player.slideSeconds`, `spawn.minObstacleGap`, `spawn.maxObstacleGap`, `spawn.trailMin`, `spawn.trailMax`, `spawn.trailSpacing`, `spawn.trailArcHeight`, `spawn.overheadY`, `spawn.buffChance`, `spawn.buffWeights`.
- Produces:
  - `export interface Spawner { populateSegment(startZ: number, length: number, difficulty: number, branch: Branch, rich: boolean, out: Entity[]): void; reset(): void; }`
  - `export function createSpawner(rng: Rng): Spawner;`

Note di progetto:
1. **Determinismo.** L'RNG è iniettato: con lo stesso seed la generazione è
   riproducibile, per questo i test possono asserire invarianti su centinaia di seed.
2. **Zero allocazioni superflue.** Nessun array temporaneo: le entità vengono scritte
   direttamente in `out` (di proprietà del chiamante) e ogni fila è generata da un
   ciclo indicizzato che scarta al volo i punti fuori dall'intervallo richiesto.
3. **L'invariante di giocabilità è un limite strutturale, non un valore copiato a
   mano.** Per ogni ostacolo, il passo minimo verso il successivo è
   `Math.max(CONFIG.spawn.minObstacleGap, requiredActionSeconds(kind) *
   CONFIG.world.maxSpeed)`, dove `requiredActionSeconds` vale `player.slideSeconds`
   per un ostacolo sospeso e `player.jumpSeconds` per uno a terra. Qualunque intervallo
   di difficoltà o di ricchezza del ramo (`rich`) resta **sempre** clampato sopra
   questo limite: se in futuro qualcuno cambia `maxSpeed` o le durate di
   salto/scivolata senza toccare `minObstacleGap`, il generatore si adatta da solo
   invece di produrre una coppia impossibile da superare. Lo Step 1 verifica questo
   fatto empiricamente su centinaia di seed, non fidandosi della matematica fatta qui.
4. **Ramo ricco vs sgombro.** A parità di kind e difficoltà, un ramo `rich` sceglie la
   distanza dal semi-intervallo **basso** (più vicino al minimo superabile: ostacoli
   più fitti) e una fila di fiocchi da `trailMin` a `trailMax`; un ramo non `rich`
   sceglie dal semi-intervallo **alto** (ostacoli più radi) e una fila ridotta da 1 a
   `ceil(trailMin / 2)` fiocchi. I buff (`crystal`, `star`, `magnet`, `bell`, scelti
   per peso con `buffWeights`) escono con probabilità `buffChance` **solo** se
   `rich` è vero: un ramo sgombro non ne genera mai.
5. **Le file insegnano l'azione.** Un ostacolo a terra è sempre preceduto da una fila
   ad arco che termina esattamente su di esso (apice `trailArcHeight` a metà fila):
   saltare lungo l'arco porta dritti sopra l'ostacolo. Un ostacolo sospeso è sempre
   accompagnato da una fila bassa (quota 0) centrata sulla sua stessa distanza: resta
   sotto la sua base (`spawn.overheadY`), quindi la si raccoglie solo scivolando.

- [ ] **Step 1: Scrivi il test che fallisce**

`src/game/spawner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import { CONFIG } from './config';
import { createSpawner } from './spawner';
import { isOverhead } from './types';
import type { Entity, ObstacleKind } from './types';

function requiredGap(kind: ObstacleKind): number {
  const seconds = isOverhead(kind) ? CONFIG.player.slideSeconds : CONFIG.player.jumpSeconds;
  return seconds * CONFIG.world.maxSpeed;
}

function isUnimodal(ys: readonly number[]): boolean {
  let rising = true;
  let previous = ys[0] ?? 0;
  for (const y of ys.slice(1)) {
    if (rising) {
      if (y < previous) rising = false;
    } else if (y > previous) {
      return false;
    }
    previous = y;
  }
  return true;
}

/** Le file ad arco sono l'UNICA fonte di fiocchi con y > 0 (le file basse e
 *  dritte stanno tutte a y = 0): raggrupparli per contiguità in z basta a
 *  ricostruire ogni singola fila ad arco dall'output piatto dello spawner. */
function groupArcTrails(entities: Entity[]): number[][] {
  const flakes = entities
    .filter((entity) => entity.kind === 'snowflake' && entity.y > 0)
    .sort((a, b) => a.z - b.z);
  const groups: number[][] = [];
  let current: number[] = [];
  let lastZ: number | null = null;
  for (const flake of flakes) {
    if (lastZ !== null && flake.z - lastZ > CONFIG.spawn.trailSpacing + 0.01) {
      groups.push(current);
      current = [];
    }
    current.push(flake.y);
    lastZ = flake.z;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

describe('populateSegment', () => {
  it('posiziona le entità dentro l-intervallo [startZ, startZ + length)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const spawner = createSpawner(createRng(seed));
      const out: Entity[] = [];
      const startZ = 300;
      const length = 500;
      spawner.populateSegment(startZ, length, 1, 'main', true, out);
      for (const entity of out) {
        expect(entity.z).toBeGreaterThanOrEqual(startZ);
        expect(entity.z).toBeLessThan(startZ + length);
      }
    }
  });

  it('assegna a ogni entità il ramo richiesto', () => {
    const spawner = createSpawner(createRng(21));
    const out: Entity[] = [];
    spawner.populateSegment(0, 800, 0.5, 'left', true, out);
    for (const entity of out) {
      expect(entity.branch).toBe('left');
    }
  });

  it('assegna id univoci e strettamente crescenti', () => {
    const spawner = createSpawner(createRng(99));
    const out: Entity[] = [];
    spawner.populateSegment(0, 2000, 1, 'main', true, out);
    expect(out.length).toBeGreaterThan(10);
    for (let i = 1; i < out.length; i++) {
      const previous = out[i - 1];
      const current = out[i];
      if (!previous || !current) throw new Error('entità mancante');
      expect(current.id).toBeGreaterThan(previous.id);
    }
  });

  it('è deterministico a parità di seed', () => {
    const a: Entity[] = [];
    createSpawner(createRng(555)).populateSegment(0, 1000, 0.5, 'right', true, a);
    const b: Entity[] = [];
    createSpawner(createRng(555)).populateSegment(0, 1000, 0.5, 'right', true, b);
    expect(a).toEqual(b);
  });

  it('marca tutte le entità come vive e coerenti nella categoria', () => {
    const out: Entity[] = [];
    createSpawner(createRng(31337)).populateSegment(0, 1500, 1, 'main', true, out);
    const buffKinds = new Set(['crystal', 'star', 'magnet', 'bell']);
    for (const entity of out) {
      expect(entity.alive).toBe(true);
      const isPickup = entity.kind === 'snowflake' || buffKinds.has(entity.kind);
      expect(entity.category).toBe(isPickup ? 'pickup' : 'obstacle');
    }
  });

  it('il ramo sgombro genera meno entità e nessun buff rispetto al ramo ricco, a parità di seed', () => {
    let richBuffs = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const richOut: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 3000, 0.5, 'left', true, richOut);
      const poorOut: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 3000, 0.5, 'right', false, poorOut);

      expect(poorOut.length).toBeLessThan(richOut.length);
      const poorHasBuff = poorOut.some(
        (entity) => entity.category === 'pickup' && entity.kind !== 'snowflake',
      );
      expect(poorHasBuff).toBe(false);
      richBuffs += richOut.filter(
        (entity) => entity.category === 'pickup' && entity.kind !== 'snowflake',
      ).length;
    }
    expect(richBuffs).toBeGreaterThan(0);
  });

  it('le file ad arco hanno y crescente e poi decrescente, con apice a trailArcHeight', () => {
    let arcsChecked = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const out: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 2000, 0.5, 'main', true, out);
      for (const group of groupArcTrails(out)) {
        if (group.length < 3) continue;
        arcsChecked++;
        expect(isUnimodal(group)).toBe(true);
        const peak = Math.max(...group);
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeLessThanOrEqual(CONFIG.spawn.trailArcHeight + 1e-9);
      }
    }
    expect(arcsChecked).toBeGreaterThan(50);
  });

  it('i fiocchi della fila bassa stanno sotto l-ostacolo sospeso a cui sono associati', () => {
    const { trailMax, trailSpacing } = CONFIG.spawn;
    const halfSpan = ((trailMax - 1) * trailSpacing) / 2 + 0.5;
    let checked = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const out: Entity[] = [];
      createSpawner(createRng(seed)).populateSegment(0, 2000, 0.5, 'main', true, out);
      const overheadObstacles = out.filter(
        (entity) => entity.category === 'obstacle' && isOverhead(entity.kind),
      );
      for (const obstacle of overheadObstacles) {
        const nearby = out.filter(
          (entity) =>
            entity.kind === 'snowflake' &&
            entity.y === 0 &&
            Math.abs(entity.z - obstacle.z) <= halfSpan,
        );
        if (nearby.length === 0) continue;
        checked++;
        for (const flake of nearby) {
          expect(flake.y).toBeLessThan(obstacle.y);
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('INVARIANTE DI GIOCABILITÀ: nessuna coppia di ostacoli consecutivi dista meno del minimo superabile alla velocità massima (300 seed x 2 rami x rich/sgombro)', () => {
    let pairsChecked = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (const rich of [true, false]) {
        const out: Entity[] = [];
        createSpawner(createRng(seed)).populateSegment(0, 5000, 1, 'main', rich, out);
        const obstacles = out
          .filter((entity) => entity.category === 'obstacle')
          .sort((a, b) => a.z - b.z);
        for (let i = 1; i < obstacles.length; i++) {
          const previous = obstacles[i - 1];
          const current = obstacles[i];
          if (!previous || !current) throw new Error('ostacolo mancante');
          const gap = current.z - previous.z;
          const minGap = requiredGap(previous.kind as ObstacleKind);
          expect(gap).toBeGreaterThanOrEqual(minGap);
          pairsChecked++;
        }
      }
    }
    expect(pairsChecked).toBeGreaterThan(1000);
  });
});

describe('reset', () => {
  it('riporta il contatore degli id a zero', () => {
    const spawner = createSpawner(createRng(8));
    const first: Entity[] = [];
    spawner.populateSegment(0, 1000, 1, 'main', true, first);
    expect(first.length).toBeGreaterThan(0);

    spawner.reset();
    const second: Entity[] = [];
    spawner.populateSegment(0, 1000, 1, 'main', true, second);
    const firstEntity = second[0];
    if (!firstEntity) throw new Error('nessuna entità generata dopo il reset');
    expect(firstEntity.id).toBe(0);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/game/spawner.test.ts`

Atteso: FAIL. Con `spawner.ts` ancora nella forma v1 (`populateChunk`/`forceRow` su
corsie, nessun `populateSegment`), la compilazione dei test fallisce per firma
mancante e per i tipi rimossi (`Lane`, `width`).

- [ ] **Step 3: Implementa il minimo necessario**

`src/game/spawner.ts`:

```ts
import type { Rng } from '../core/rng';
import { CONFIG } from './config';
import type {
  Branch,
  BuffKind,
  Entity,
  GroundObstacleKind,
  ObstacleKind,
  OverheadObstacleKind,
} from './types';
import { isOverhead } from './types';

const GROUND_OBSTACLES: readonly GroundObstacleKind[] = ['rock', 'log', 'fence', 'crevasse'];
const OVERHEAD_OBSTACLES: readonly OverheadObstacleKind[] = ['branch', 'arch', 'cornice'];
const BUFF_KINDS: readonly BuffKind[] = ['crystal', 'star', 'magnet', 'bell'];

export interface Spawner {
  /** Popola un tratto di percorso su un ramo, aggiungendo entità a `out`. */
  populateSegment(
    startZ: number,
    length: number,
    difficulty: number,
    branch: Branch,
    rich: boolean,
    out: Entity[],
  ): void;
  reset(): void;
}

export function createSpawner(rng: Rng): Spawner {
  const { minObstacleGap, maxObstacleGap, trailMin, trailMax, trailSpacing, trailArcHeight } =
    CONFIG.spawn;
  const gapSpread = maxObstacleGap - minObstacleGap;

  let nextId = 0;

  function emit(
    out: Entity[],
    kind: Entity['kind'],
    category: 'obstacle' | 'pickup',
    branch: Branch,
    z: number,
    y: number,
  ): void {
    out.push({ id: nextId++, kind, category, branch, z, y, alive: true });
  }

  /** Tempo reale che serve a completare l'azione richiesta da questo ostacolo:
   *  scivolata per i sospesi, salto per quelli a terra. È la base
   *  dell'invariante di giocabilità (vedi Note di progetto). */
  function requiredActionSeconds(kind: ObstacleKind): number {
    return isOverhead(kind) ? CONFIG.player.slideSeconds : CONFIG.player.jumpSeconds;
  }

  function pickObstacleKind(): ObstacleKind {
    return rng.chance(0.5) ? rng.pick(GROUND_OBSTACLES) : rng.pick(OVERHEAD_OBSTACLES);
  }

  function pickBuffKind(): BuffKind {
    const weights = CONFIG.spawn.buffWeights;
    const total = weights.crystal + weights.star + weights.magnet + weights.bell;
    let roll = rng.next() * total;
    for (const kind of BUFF_KINDS) {
      roll -= weights[kind];
      if (roll < 0) return kind;
    }
    const fallback = BUFF_KINDS[BUFF_KINDS.length - 1];
    if (fallback === undefined) throw new Error('pickBuffKind: BUFF_KINDS vuoto');
    return fallback;
  }

  /** Fila ad arco che insegna il salto: termina esattamente sull'ostacolo a terra
   *  (l'ultimo fiocco coincide con esso), apice a trailArcHeight a metà fila. I
   *  punti che cadrebbero prima dell'inizio del segmento vengono scartati. */
  function emitArcTrail(
    obstacleZ: number,
    branch: Branch,
    count: number,
    startZ: number,
    out: Entity[],
  ): void {
    for (let i = 0; i < count; i++) {
      const z = obstacleZ - (count - 1 - i) * trailSpacing;
      if (z < startZ) continue;
      const t = count > 1 ? i / (count - 1) : 0.5;
      const y = trailArcHeight * Math.sin(Math.PI * t);
      emit(out, 'snowflake', 'pickup', branch, z, y);
    }
  }

  /** Fila bassa che insegna la scivolata: centrata sull'ostacolo sospeso, a quota
   *  0 (sotto la sua base, spawn.overheadY). */
  function emitLowTrail(
    obstacleZ: number,
    branch: Branch,
    count: number,
    startZ: number,
    endZ: number,
    out: Entity[],
  ): void {
    const half = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      const z = obstacleZ + (i - half) * trailSpacing;
      if (z < startZ || z >= endZ) continue;
      emit(out, 'snowflake', 'pickup', branch, z, 0);
    }
  }

  return {
    populateSegment(
      startZ: number,
      length: number,
      difficulty: number,
      branch: Branch,
      rich: boolean,
      out: Entity[],
    ): void {
      const clamped = Math.min(1, Math.max(0, difficulty));
      const endZ = startZ + length;
      let cursorZ = startZ;

      while (cursorZ < endZ) {
        const kind = pickObstacleKind();
        const overhead = isOverhead(kind);

        // La distanza scelta cala con la difficoltà, ma non scende MAI sotto il
        // tempo reale che serve a completare l'azione richiesta da questo
        // ostacolo alla velocità massima: è l'invariante di giocabilità.
        const minTraversableGap = requiredActionSeconds(kind) * CONFIG.world.maxSpeed;
        const rangeLow = Math.max(minObstacleGap, minTraversableGap);
        const desiredHigh = maxObstacleGap - gapSpread * clamped;
        const rangeHigh = Math.max(rangeLow, desiredHigh);
        const midpoint = (rangeLow + rangeHigh) / 2;
        // Ramo ricco: distanza nel semi-intervallo basso (ostacoli più fitti).
        // Ramo sgombro: semi-intervallo alto (ostacoli più radi).
        const gap = rich
          ? rangeLow + rng.next() * (midpoint - rangeLow)
          : midpoint + rng.next() * (rangeHigh - midpoint);

        emit(out, kind, 'obstacle', branch, cursorZ, overhead ? CONFIG.spawn.overheadY : 0);

        // Ramo ricco: fila lunga (trailMin..trailMax). Ramo sgombro: fila corta
        // (1..ceil(trailMin/2)), sempre più povera ma mai assente.
        const trailCount = rich
          ? rng.int(trailMin, trailMax + 1)
          : rng.int(1, Math.ceil(trailMin / 2) + 1);

        if (overhead) {
          emitLowTrail(cursorZ, branch, trailCount, startZ, endZ, out);
        } else {
          emitArcTrail(cursorZ, branch, trailCount, startZ, out);
        }

        // I buff esistono solo sul ramo ricco: è ciò che rende la scelta al
        // bivio una scelta vera (vedi design doc).
        if (rich && rng.chance(CONFIG.spawn.buffChance)) {
          const buffZ = cursorZ + gap / 2;
          if (buffZ < endZ) emit(out, pickBuffKind(), 'pickup', branch, buffZ, 0);
        }

        cursorZ += gap;
      }
    },
    reset(): void {
      nextId = 0;
    },
  };
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`

Atteso: PASS su tutta la suite. In particolare devono passare l'invariante di
giocabilità sui 300 seed × 2 rami × rich/sgombro (oltre 1000 coppie di ostacoli
verificate), il confronto ramo ricco/sgombro e le forme delle file (ad arco e
bassa).

Verifica anche i tipi: `npm run typecheck` → nessun errore. Se `game.ts` o altri
consumatori chiamano ancora `populateChunk`/`forceRow` o referenziano `Lane`/`width`,
aggiornali nello stesso commit: il contratto vieta di lasciare la suite rossa a fine
task.

- [ ] **Step 5: Commit**

```bash
git add src/game/spawner.ts src/game/spawner.test.ts
git commit -m "refactor(game): rewrite spawner as a single-branch obstacle-and-trail generator"
```

---

### Task 6: Buff attivi (stella, calamita, campanaccio) — `src/game/buffs.ts`

**Files:**
- Create: `src/game/buffs.ts`
- Modify: `src/core/events.ts`
- Test: `src/game/buffs.test.ts`

**Interfaces:**
- Consumes:
  - `EventBus` da `src/core/events.ts`
  - `CONFIG.buffs = { starSeconds: 8, starMultiplier: 2, magnetSeconds: 8, magnetRangeZ: 14 }` da `src/game/config.ts`
  - `type BuffKind` (`'crystal' | 'star' | 'magnet' | 'bell'`) da `src/game/types.ts`
- Produces:
  - `export interface BuffState { shield: boolean; starTimeLeft: number; magnetTimeLeft: number }`
  - `export function createBuffs(): BuffState`
  - `export function resetBuffs(state: BuffState): void`
  - `export function applyBuff(state: BuffState, kind: BuffKind, bus: EventBus): void`
  - `export function updateBuffs(state: BuffState, dt: number, bus: EventBus): void`
  - `export function consumeShield(state: BuffState, bus: EventBus): boolean`
  - `export function buffMultiplier(state: BuffState): number`
  - `export function magnetActive(state: BuffState): boolean`

**Note di progetto (decise qui, valide per il Task 7):**
- **Stella e calamita: raccoglierle mentre sono già attive RICARICA la durata, non la somma.** `applyBuff` scrive `CONFIG.buffs.starSeconds`/`magnetSeconds` come valore assoluto, non come incremento. Motivo: se si sommasse, incatenare più raccolte farebbe scadere il buff a un tempo via via meno prevedibile, e l'HUD (un solo numero residuo) mentirebbe o dovrebbe gestire un tetto arbitrario non previsto dal contratto. Un tetto fisso ricaricabile è più leggibile: "hai ancora N secondi", punto.
- **Il campanaccio è un interruttore, non un contatore.** `state.shield` è un booleano: raccoglierne un secondo mentre il primo è ancora attivo lascia `shield` a `true` senza alcun effetto ulteriore (nessuna scorta accumulata, coerente col design "raccogliere uno scudo mentre se ne ha già uno non li accumula: ricarica solo quello" — qui "ricarica" è vuota perché non c'è nulla da consumare nel frattempo).
- **`'crystal'` non passa da `applyBuff`.** Dà carica alla valanga, non stato: è `game.ts` (Task 7) a chiamare `addCharge` direttamente quando il pickup raccolto è `'crystal'`. Se lo si passa qui per errore, la funzione fa un early return silenzioso e NON emette `'buff:gained'`: il cristallo non è un buff con stato, quindi non genera quell'evento.
- **`'buff:expired'` una sola volta a testa.** `updateBuffs` scala `starTimeLeft`/`magnetTimeLeft` SOLO se sono già `> 0`: una volta arrivati a 0, chiamate successive non fanno nulla e non remittono l'evento. È lo stesso pattern di `avalanche.ts` (`avalanche:ended` emesso una sola volta all'esaurimento di `timeLeft`).
- Il contratto elenca solo tre nuovi eventi sul bus per i buff: `'buff:gained'`, `'buff:expired'`, `'shield:consumed'`. Vanno aggiunti a `GameEvents` in `src/core/events.ts`; gli eventi `'fork:appeared'`/`'fork:chosen'`/`'fork:resolved'` sono già stati aggiunti dal task che ha introdotto `src/game/path.ts` (uno dei Task 1–5): non li tocchiamo, solo li lasciamo dove sono e aggiungiamo i nostri tre subito dopo.

- [ ] **Step 1: Scrivi il test che fallisce**

```ts
// src/game/buffs.test.ts
import { describe, expect, it } from 'vitest';
import { createEventBus, type EventBus, type EventName, type GameEvents } from '../core/events';
import { CONFIG } from './config';
import {
  applyBuff,
  buffMultiplier,
  consumeShield,
  createBuffs,
  magnetActive,
  resetBuffs,
  updateBuffs,
} from './buffs';

interface Recorded {
  name: EventName;
  payload: unknown;
}

const ALL_EVENTS: EventName[] = ['buff:gained', 'buff:expired', 'shield:consumed'];

function recordEvents(bus: EventBus): Recorded[] {
  const seen: Recorded[] = [];
  for (const name of ALL_EVENTS) {
    bus.on(name, (payload: unknown) => {
      seen.push({ name, payload });
    });
  }
  return seen;
}

function countOf(events: readonly Recorded[], name: EventName): number {
  return events.filter((event) => event.name === name).length;
}

function payloadsOf<K extends EventName>(
  events: readonly Recorded[],
  name: K,
): GameEvents[K][] {
  return events
    .filter((event) => event.name === name)
    .map((event) => event.payload as GameEvents[K]);
}

describe('createBuffs', () => {
  it('parte tutto spento/azzerato', () => {
    expect(createBuffs()).toEqual({ shield: false, starTimeLeft: 0, magnetTimeLeft: 0 });
  });
});

describe('applyBuff', () => {
  it('star imposta la durata piena ed emette buff:gained', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();

    applyBuff(state, 'star', bus);

    expect(state.starTimeLeft).toBe(CONFIG.buffs.starSeconds);
    expect(payloadsOf(events, 'buff:gained')).toEqual([{ kind: 'star' }]);
  });

  it('magnet imposta la durata piena ed emette buff:gained', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();

    applyBuff(state, 'magnet', bus);

    expect(state.magnetTimeLeft).toBe(CONFIG.buffs.magnetSeconds);
    expect(payloadsOf(events, 'buff:gained')).toEqual([{ kind: 'magnet' }]);
  });

  it('raccogliere star o magnet mentre sono già attivi RICARICA la durata, non la somma', () => {
    const bus = createEventBus();
    const state = createBuffs();

    applyBuff(state, 'star', bus);
    updateBuffs(state, CONFIG.buffs.starSeconds - 1, bus);
    expect(state.starTimeLeft).toBeCloseTo(1, 6);

    applyBuff(state, 'star', bus);
    expect(state.starTimeLeft).toBe(CONFIG.buffs.starSeconds);

    applyBuff(state, 'magnet', bus);
    updateBuffs(state, CONFIG.buffs.magnetSeconds - 2, bus);
    expect(state.magnetTimeLeft).toBeCloseTo(2, 6);

    applyBuff(state, 'magnet', bus);
    expect(state.magnetTimeLeft).toBe(CONFIG.buffs.magnetSeconds);
  });

  it('bell accende lo scudo ed emette buff:gained', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();

    applyBuff(state, 'bell', bus);

    expect(state.shield).toBe(true);
    expect(payloadsOf(events, 'buff:gained')).toEqual([{ kind: 'bell' }]);
  });

  it('raccogliere bell con lo scudo già attivo non accumula nulla', () => {
    const bus = createEventBus();
    const state = createBuffs();

    applyBuff(state, 'bell', bus);
    applyBuff(state, 'bell', bus);

    expect(state.shield).toBe(true);
    expect(consumeShield(state, bus)).toBe(true);
    expect(state.shield).toBe(false);
    // Un solo scudo, non due: un secondo consumo trova la scorta già vuota.
    expect(consumeShield(state, bus)).toBe(false);
  });

  it('crystal non tocca lo stato dei buff: la carica è gestita altrove (game.ts)', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();

    applyBuff(state, 'crystal', bus);

    expect(state).toEqual({ shield: false, starTimeLeft: 0, magnetTimeLeft: 0 });
    expect(events).toHaveLength(0);
  });
});

describe('updateBuffs', () => {
  it('scala i tempi residui del delta time', () => {
    const bus = createEventBus();
    const state = createBuffs();
    applyBuff(state, 'star', bus);
    applyBuff(state, 'magnet', bus);

    updateBuffs(state, 1, bus);

    expect(state.starTimeLeft).toBeCloseTo(CONFIG.buffs.starSeconds - 1, 6);
    expect(state.magnetTimeLeft).toBeCloseTo(CONFIG.buffs.magnetSeconds - 1, 6);
  });

  it('emette buff:expired UNA SOLA VOLTA per buff, anche richiamata molte volte dopo la scadenza', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();
    applyBuff(state, 'star', bus);

    updateBuffs(state, CONFIG.buffs.starSeconds, bus);
    expect(state.starTimeLeft).toBe(0);
    expect(countOf(events, 'buff:expired')).toBe(1);
    expect(payloadsOf(events, 'buff:expired')).toEqual([{ kind: 'star' }]);

    for (let i = 0; i < 50; i++) updateBuffs(state, 1, bus);
    expect(countOf(events, 'buff:expired')).toBe(1);
  });

  it('star e magnet scadono in modo indipendente, ciascuno col proprio evento', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();
    applyBuff(state, 'star', bus);
    applyBuff(state, 'magnet', bus);

    updateBuffs(state, CONFIG.buffs.starSeconds, bus);
    expect(payloadsOf(events, 'buff:expired')).toEqual([{ kind: 'star' }]);

    updateBuffs(state, CONFIG.buffs.magnetSeconds - CONFIG.buffs.starSeconds, bus);
    expect(payloadsOf(events, 'buff:expired')).toEqual([{ kind: 'star' }, { kind: 'magnet' }]);
  });

  it('non fa nulla se nessun buff è attivo', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();

    updateBuffs(state, 5, bus);

    expect(state).toEqual({ shield: false, starTimeLeft: 0, magnetTimeLeft: 0 });
    expect(events).toHaveLength(0);
  });
});

describe('consumeShield', () => {
  it('restituisce false e non emette nulla se lo scudo non è attivo', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();

    expect(consumeShield(state, bus)).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('restituisce true, spegne lo scudo ed emette shield:consumed se era attivo', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createBuffs();
    applyBuff(state, 'bell', bus);

    expect(consumeShield(state, bus)).toBe(true);
    expect(state.shield).toBe(false);
    expect(countOf(events, 'shield:consumed')).toBe(1);
  });
});

describe('buffMultiplier / magnetActive', () => {
  it('il moltiplicatore vale starMultiplier con la stella attiva, altrimenti 1', () => {
    const bus = createEventBus();
    const state = createBuffs();
    expect(buffMultiplier(state)).toBe(1);

    applyBuff(state, 'star', bus);
    expect(buffMultiplier(state)).toBe(CONFIG.buffs.starMultiplier);

    updateBuffs(state, CONFIG.buffs.starSeconds, bus);
    expect(buffMultiplier(state)).toBe(1);
  });

  it('magnetActive segue magnetTimeLeft', () => {
    const bus = createEventBus();
    const state = createBuffs();
    expect(magnetActive(state)).toBe(false);

    applyBuff(state, 'magnet', bus);
    expect(magnetActive(state)).toBe(true);

    updateBuffs(state, CONFIG.buffs.magnetSeconds, bus);
    expect(magnetActive(state)).toBe(false);
  });
});

describe('resetBuffs', () => {
  it('riporta tutto a zero', () => {
    const bus = createEventBus();
    const state = createBuffs();
    applyBuff(state, 'star', bus);
    applyBuff(state, 'magnet', bus);
    applyBuff(state, 'bell', bus);

    resetBuffs(state);

    expect(state).toEqual({ shield: false, starTimeLeft: 0, magnetTimeLeft: 0 });
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/game/buffs.test.ts`
Atteso: FAIL con `Failed to resolve import "./buffs" from "src/game/buffs.test.ts"`.

- [ ] **Step 3: Aggiungi i tre eventi a `src/core/events.ts`**

Il file esiste già ed è già stato ampliato dal task che ha introdotto `src/game/path.ts` con `'fork:appeared'`, `'fork:chosen'`, `'fork:resolved'`. Aggiungi l'import di `BuffKind` e le tre chiavi seguenti, subito dopo `'avalanche:ended'`:

```ts
// src/core/events.ts — stato atteso dopo questo step
import type { BuffKind, Lane, ObstacleKind, PickupKind } from '../game/types';

export interface GameEvents {
  'run:started': { seed: number };
  'run:ended': { points: number; distance: number; isRecord: boolean };
  'run:stopped': Record<string, never>;
  'pickup:collected': { kind: PickupKind; charge: number };
  /** Il tracciato si sdoppia: `richBranch` è il ramo con più fiocchi/buff e più
   *  ostacoli (quello "difficile"); l'altro è sempre lo sgombro. */
  'fork:appeared': { richBranch: 'left' | 'right' };
  /** Emesso ogni volta che chooseBranch() registra una scelta valida, anche
   *  se cambiata più volte prima del punto di non ritorno. */
  'fork:chosen': { side: 'left' | 'right' };
  /** Emesso una sola volta, quando la scelta diventa definitiva (spontanea o
   *  imposta): da qui in poi il ramo indicato è quello solido. */
  'fork:resolved': { side: 'left' | 'right' };
  'obstacle:hit': {
    kind: ObstacleKind;
    outcome: 'death' | 'forgiven' | 'smashed';
    lane: Lane;
    z: number;
  };
  'size:changed': { size: number; previous: number };
  'avalanche:triggered': { size: number };
  'avalanche:ending': Record<string, never>;
  'avalanche:ended': Record<string, never>;
  /** Raccolto un buff con stato (stella, calamita o campanaccio): 'crystal'
   *  non passa da qui, dà solo carica (vedi game.ts). */
  'buff:gained': { kind: BuffKind };
  /** Scadenza naturale di stella o calamita: emesso una sola volta a testa. */
  'buff:expired': { kind: BuffKind };
  /** Lo scudo ha assorbito un impatto che altrimenti sarebbe stato letale. */
  'shield:consumed': Record<string, never>;
}

export type EventName = keyof GameEvents;

export interface EventBus {
  on<K extends EventName>(name: K, handler: (payload: GameEvents[K]) => void): () => void;
  emit<K extends EventName>(name: K, payload: GameEvents[K]): void;
  clear(): void;
}
```

Il resto del file (`AnyHandler`, `createEventBus`) resta invariato: nessuna delle due funzioni dipende dall'elenco delle chiavi.

**Nota:** `'obstacle:hit'` ha ancora `lane: Lane` in questo step. `Lane` non esiste più in `src/game/types.ts` (rimosso dal task che ha riscritto i tipi): questo campo lascia `src/core/events.ts` — e con esso l'intero progetto — non tipizzabile fino al Task 7, che sostituisce `lane` con `branch`. È lo stesso motivo per cui `npm run typecheck` resta rosso finché il Task 7 non chiude il cerchio: non è una svista di questo step, è la demolizione descritta nel piano.

- [ ] **Step 4: Implementa `src/game/buffs.ts`**

```ts
// src/game/buffs.ts
import type { EventBus } from '../core/events';
import { CONFIG } from './config';
import type { BuffKind } from './types';

export interface BuffState {
  shield: boolean;
  /** Secondi residui della stella (moltiplicatore di punteggio). */
  starTimeLeft: number;
  /** Secondi residui della calamita (attira i fiocchi). */
  magnetTimeLeft: number;
}

export function createBuffs(): BuffState {
  return { shield: false, starTimeLeft: 0, magnetTimeLeft: 0 };
}

export function resetBuffs(state: BuffState): void {
  state.shield = false;
  state.starTimeLeft = 0;
  state.magnetTimeLeft = 0;
}

/**
 * Applica un buff raccolto. 'crystal' NON passa di qui: dà carica alla
 * valanga, non stato (vedi game.ts, che per 'crystal' chiama addCharge
 * direttamente). Raccogliere stella o calamita mentre sono già attive
 * RICARICA la durata invece di sommarla: un tetto fisso è leggibile
 * ("hai ancora N secondi"), una somma illimitata no. Il campanaccio è un
 * interruttore, non un contatore: raccoglierne un secondo mentre lo scudo
 * è già acceso lascia lo stato identico, senza scorta accumulata.
 */
export function applyBuff(state: BuffState, kind: BuffKind, bus: EventBus): void {
  switch (kind) {
    case 'star':
      state.starTimeLeft = CONFIG.buffs.starSeconds;
      break;
    case 'magnet':
      state.magnetTimeLeft = CONFIG.buffs.magnetSeconds;
      break;
    case 'bell':
      state.shield = true;
      break;
    case 'crystal':
      // Nessuno stato da aggiornare qui: niente evento, niente effetto.
      return;
  }
  bus.emit('buff:gained', { kind });
}

/**
 * Scala i tempi residui del delta time. `buff:expired` viene emesso UNA SOLA
 * VOLTA per buff, esattamente nel frame in cui il tempo passa da positivo a
 * zero: la guardia `> 0` all'ingresso di ciascun blocco impedisce che i
 * frame successivi (dopo la scadenza) rientrino nel ramo e remittano
 * l'evento, stesso pattern di avalanche:ended in avalanche.ts.
 */
export function updateBuffs(state: BuffState, dt: number, bus: EventBus): void {
  if (state.starTimeLeft > 0) {
    state.starTimeLeft = Math.max(0, state.starTimeLeft - dt);
    if (state.starTimeLeft === 0) bus.emit('buff:expired', { kind: 'star' });
  }
  if (state.magnetTimeLeft > 0) {
    state.magnetTimeLeft = Math.max(0, state.magnetTimeLeft - dt);
    if (state.magnetTimeLeft === 0) bus.emit('buff:expired', { kind: 'magnet' });
  }
}

/** Consuma lo scudo se presente. Restituisce true se ha assorbito il colpo. */
export function consumeShield(state: BuffState, bus: EventBus): boolean {
  if (!state.shield) return false;
  state.shield = false;
  bus.emit('shield:consumed', {});
  return true;
}

export function buffMultiplier(state: BuffState): number {
  return state.starTimeLeft > 0 ? CONFIG.buffs.starMultiplier : 1;
}

export function magnetActive(state: BuffState): boolean {
  return state.magnetTimeLeft > 0;
}
```

- [ ] **Step 5: Esegui i test e verifica che passino**

Comando: `npm run test:run -- src/game/buffs.test.ts`
Atteso: PASS.
Comando: `npm run typecheck`
Atteso: ANCORA IN ERRORE (vedi nota dello Step 3: `'obstacle:hit'.lane: Lane` non è più tipizzabile). Verifica solo che gli errori residui riguardino esclusivamente quel campo e i suoi consumatori (`src/game/game.ts`, `src/main.ts`, `src/audio/audio.ts`), non `src/game/buffs.ts` né `src/game/buffs.test.ts`: sono quelli il termometro di questo step, e devono essere puliti.

- [ ] **Step 6: Commit**

```bash
git add src/game/buffs.ts src/game/buffs.test.ts src/core/events.ts
git commit -m "feat(buffs): add shield, star and magnet state with gain/expire events"
```

---

### Task 7: Orchestratore di gioco per il tracciato a bivi — `src/game/game.ts`

**Files:**
- Modify: `src/game/game.ts`
- Modify: `src/game/avalanche.ts`
- Modify: `src/core/events.ts`
- Modify: `src/game/config.ts`
- Modify: `src/main.ts`
- Test: `src/game/game.test.ts`
- Test: `src/game/avalanche.test.ts`

**Interfaces:**
- Consumes:
  - `createRng(seed: number): Rng` da `src/core/rng.ts`
  - `EventBus` da `src/core/events.ts`
  - `createWorld(): WorldState`, `updateWorld(world: WorldState, dt: number): void` da `src/game/world.ts`
  - `createPath(): PathState`, `updatePath(path, travelled, speed, rng, bus): void`, `chooseBranch(path, side): boolean`, `branchIsSolid(path, branch): boolean`, `type ForkPhase` da `src/game/path.ts`
  - `createPlayer(): PlayerState`, `jump(player): void`, `slide(player): void`, `updatePlayer(player, dt): void` da `src/game/player.ts`
  - `createAvalanche`, `addCharge`, `updateAvalanche`, `applyForgivenessPenalty`, `canSmash`, `scoreMultiplier` da `src/game/avalanche.ts`
  - `createBuffs`, `applyBuff`, `updateBuffs`, `consumeShield`, `buffMultiplier`, `magnetActive` da `src/game/buffs.ts` (Task 6)
  - `createScore`, `addDistance`, `addBonus`, `saveRecord` da `src/game/score.ts`
  - `createSpawner(rng): Spawner` con `populateSegment(startZ, length, difficulty, branch, rich, out)` da `src/game/spawner.ts`
  - `playerBox(y, size, sliding)`, `entityBox(entity)`, `boxesOverlap(a, b)`, `ENTITY_BOX` da `src/game/collisions.ts`
  - `difficultyAt(distance: number): number` da `src/game/speed.ts`
- Produces:
  - `export interface GameState { seed: number; rng: Rng; bus: EventBus; world: WorldState; path: PathState; player: PlayerState; avalanche: AvalancheState; buffs: BuffState; score: ScoreState; spawner: Spawner; entities: Entity[]; alive: boolean; forgivenessUsed: boolean }`
  - `export function createGame(seed: number, bus: EventBus): GameState`
  - `export function startRun(game: GameState, seed?: number): void`
  - `export function abandonRun(game: GameState): void`
  - `export function handleAction(game: GameState, action: Action): void`
  - `export function updateGame(game: GameState, dt: number): void`
  - `export function advanceWorldOnly(game: GameState, dt: number): void`

**Note di progetto (le scelte non fissate dal contratto, decise qui):**

1. **Solidità e collisioni.** Si collide/raccoglie SOLO con entità il cui `branch` è solido (`branchIsSolid(path, entity.branch)`): il controllo entra nel loop di collisione PRIMA del test di sovrapposizione, così un'entità su un ramo non scelto non genera mai una box né un evento — esiste, si vede (compito della vista), è inerte per la logica.

2. **Come "un solo segmento sul tronco, due ai bivi" si traduce in codice.** Il mondo resta un'unica linea: il rifornimento di routine (guidato dai chunk riciclati di `world.ts`, invariato) continua a chiamare `populateSegment` con `branch: 'main'`, esattamente come prima chiamava `populateChunk`. Il bivio non ha un proprio meccanismo di generazione a parte: quando `path.phase` passa da `'none'` ad `'approaching'` (rilevato confrontando la fase prima e dopo `updatePath` nello stesso frame), la finestra `[0, CONFIG.path.previewZ]` smette di essere tronco: le eventuali entità `'main'` già lì (generate da un riciclo di chunk avvenuto molto prima, ignaro del bivio) vengono rimosse, e la stessa finestra viene ripopolata due volte, una per `'left'` e una per `'right'`, con `rich` assegnato secondo `path.richBranch`. Non serve nessun nuovo campo di stato: la finestra è sempre `[0, previewZ]` al momento esatto in cui nasce il bivio, e da lì le entità scorrono in avanti (calo di `z`) esattamente come tutte le altre.

3. **Chiusura di un bivio: rimozione dello scartato, poi fusione dello scelto nel tronco.** Alla transizione `'approaching' → 'committed'` (scelta fissata, spontanea o imposta), le entità del ramo NON scelto vengono marcate morte immediatamente: “nessun leak” è garantito nello stesso frame in cui la scelta diventa definitiva, non alla prossima compattazione casuale. Alla transizione successiva, quando `path.ts` chiude il bivio (`phase → 'none'`, `activeBranch → 'main'`), le entità sopravvissute del ramo scelto (catturato PRIMA di chiamare `updatePath`, perché `updatePath` lo azzera a `'main'` nello stesso momento) vengono rietichettate `branch: 'main'`: senza questo passo `branchIsSolid` le renderebbe di nuovo inerti un istante dopo che il riallineamento visivo le ha già portate al centro.

4. **Precedenza sull'impatto con un ostacolo:** `canSmash` (sfondamento) → `consumeShield` (nuovo esito `'shielded'`) → perdono (`forgiveness`) → morte. Lo scudo è controllato DOPO lo sfondamento (se la valanga sfonda comunque, lo scudo resta intatto per un urto futuro) e PRIMA del perdono (uno scudo disponibile protegge sempre, indipendentemente dalla carica accumulata).

5. **La calamita raccoglie direttamente, non "trascina".** Il contratto non introduce una velocità di trascinamento in `config.ts` (solo un raggio, `magnetRangeZ`): far scorrere un fiocco verso il giocatore richiederebbe un numero di bilanciamento non specificato. La scelta più semplice e fedele al comportamento osservabile ("la calamita raccoglie fiocchi che il giocatore non tocca direttamente") è trattare ogni fiocco alive, sul ramo solido, con `0 <= z <= magnetRangeZ`, come raccolto immediatamente — stesso percorso di `collectPickup` usato dalla collisione normale. Il passo "calamita" gira PRIMA del loop di collisione, cosicché un fiocco già raccolto dalla calamita non viene ri-processato (è morto, il loop lo scarta).

6. **Punteggio con doppio moltiplicatore.** `scoreMultiplier(avalanche) * buffMultiplier(buffs)`: i due moltiplicatori sono indipendenti e si moltiplicano fra loro (valanga ×5, stella ×2 → ×10 quando coincidono), esattamente come da design doc §9.

7. **`'crystal'` fuori da `applyBuff`.** In `collectPickup`, se `kind === 'crystal'` si chiama `addCharge` con `CONFIG.pickups.charge.crystal` (20), esattamente come `'snowflake'`; se `kind` è `'star' | 'magnet' | 'bell'` si chiama `applyBuff` e la carica resta a zero (`pickups.charge` per questi tre vale già 0 in config, quindi anche chiamando `addCharge` sarebbe un no-op — ma non lo chiamiamo, per non lasciare un'istruzione morta).

8. **`CONFIG.score.pickupBonus` non è specificato dal contratto per le nuove chiavi.** `PickupKind` è cambiato (`snowflake, crystal, star, magnet, bell`) ma il contratto lascia `score` "invariato salvo dove indicato": la mappa vecchia (`snowflake, hay, cow`) non compila più contro il nuovo `PickupKind`. La aggiorniamo qui con valori scelti in base alla rarità di design doc §7 (comune → raro): `{ snowflake: 5, crystal: 15, star: 20, magnet: 20, bell: 30 }`.

9. **`canSmash` in `avalanche.ts` referenziava `'tree'`, kind ormai inesistente.** `'tree'` non è più un `ObstacleKind` (è scenografia in v2): il confronto `kind !== 'tree'` non compila più (TypeScript segnala l'assenza di sovrapposizione fra i tipi). Fuori dalla valanga resta sfondabile da taglia 3 solo `'fence'`, l'unico kind smashable della vecchia coppia rimasto in `ObstacleKind`. È un aggiustamento di una riga, diretto discendente della riscrittura di `types.ts` (Task 1): rientra nel mandato di questo task ("sistemare i punti rimasti rotti nella logica di gioco"), non nella clausola "avalanche.ts non va toccato salvo i numeri in config", che è precedente a questa scoperta.

10. **Niente più `sizeBonusCharge`.** Il meccanismo v1 (`CONFIG.pickups.sizeBonus`, scatto di taglia immediato alla raccolta) non è nel blocco `pickups` del contratto v2 (che ha solo `charge`): la taglia sale unicamente per soglie di carica, come già succede per la distanza e per la valanga. Rimosso senza sostituto.

11. **Scope di "vista":** `entities-view.ts`, `player-view.ts`, `terrain.ts`, `models.ts`, `gesture.ts`, `hud.ts` NON sono toccati da questo task (sono nella sezione "Vista" del contratto, task successivi non compresi in questo blocco). Continueranno a riferire campi rimossi da `Entity` (`lane`, `width`) e kind non ancora modellati (`log`, `arch`, `cornice`, `crystal`, `star`, `magnet`, `bell`) finché quei task non li aggiornano: lo Step finale lo verifica e lo dichiara esplicitamente, non lo nasconde. L'unico consumatore esterno a `src/game/**` toccato qui è `src/main.ts`, e SOLO nel punto in cui legge `payload.lane` dall'evento `'obstacle:hit'` (altrimenti non compilerebbe più): è un aggiustamento minimo, non una riscrittura della vista.

- [ ] **Step 1: Scrivi il test che fallisce**

```ts
// src/game/game.test.ts
import { describe, expect, it } from 'vitest';
import {
  createEventBus,
  type EventBus,
  type EventName,
  type GameEvents,
} from '../core/events';
import { addCharge } from './avalanche';
import { applyBuff } from './buffs';
import { CONFIG } from './config';
import {
  abandonRun,
  advanceWorldOnly,
  createGame,
  handleAction,
  startRun,
  updateGame,
  type GameState,
} from './game';
import type { Branch, Entity } from './types';

const STEP = 1 / 60;

interface Recorded {
  name: EventName;
  payload: unknown;
}

const ALL_EVENTS: EventName[] = [
  'run:started',
  'run:ended',
  'run:stopped',
  'pickup:collected',
  'obstacle:hit',
  'size:changed',
  'avalanche:triggered',
  'avalanche:ending',
  'avalanche:ended',
  'fork:appeared',
  'fork:chosen',
  'fork:resolved',
  'buff:gained',
  'buff:expired',
  'shield:consumed',
];

function recordEvents(bus: EventBus): Recorded[] {
  const seen: Recorded[] = [];
  for (const name of ALL_EVENTS) {
    bus.on(name, (payload: unknown) => {
      seen.push({ name, payload });
    });
  }
  return seen;
}

function countOf(events: readonly Recorded[], name: EventName): number {
  return events.filter((event) => event.name === name).length;
}

function payloadsOf<K extends EventName>(
  events: readonly Recorded[],
  name: K,
): GameEvents[K][] {
  return events
    .filter((event) => event.name === name)
    .map((event) => event.payload as GameEvents[K]);
}

function groundObstacle(branch: Branch = 'main', z = 5): Entity {
  return { id: 1, kind: 'rock', category: 'obstacle', branch, z, y: 0, alive: true };
}

function overheadObstacle(branch: Branch = 'main', z = 5): Entity {
  return { id: 2, kind: 'branch', category: 'obstacle', branch, z, y: CONFIG.spawn.overheadY, alive: true };
}

function snowflake(branch: Branch = 'main', z = 5): Entity {
  return { id: 3, kind: 'snowflake', category: 'pickup', branch, z, y: 0, alive: true };
}

/**
 * Piazza una sola entità sul ramo indicato, a 5 unità dal giocatore. A 18
 * u/s l'impatto avviene entro ~17 frame; 60 frame simulati restano
 * abbondantemente sotto al primo riciclo di chunk, quindi nessuna entità
 * generata dallo spawner interferisce con lo scenario.
 */
function scenario(seed: number, entity: Entity): { game: GameState; events: Recorded[] } {
  const bus = createEventBus();
  const game = createGame(seed, bus);
  startRun(game);
  const events = recordEvents(bus);
  game.entities.length = 0;
  game.entities.push(entity);
  return { game, events };
}

function runFrames(game: GameState, frames: number): void {
  for (let frame = 0; frame < frames; frame += 1) {
    updateGame(game, STEP);
  }
}

describe('startRun', () => {
  it('reinizializza tutto, incluso path e buffs, ed emette run:started', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const game = createGame(99, bus);

    startRun(game);
    runFrames(game, 120);
    expect(game.score.points).toBeGreaterThan(0);

    game.forgivenessUsed = true;
    game.alive = false;
    applyBuff(game.buffs, 'star', game.bus);
    startRun(game, 7);

    expect(game.seed).toBe(7);
    expect(game.alive).toBe(true);
    expect(game.forgivenessUsed).toBe(false);
    expect(game.entities.length).toBeGreaterThan(0);
    for (const entity of game.entities) {
      expect(entity.z).toBeGreaterThanOrEqual(CONFIG.world.spawnSafeZ);
      expect(entity.branch).toBe('main');
    }
    expect(game.score).toEqual({ points: 0, distance: 0 });
    expect(game.world.distance).toBe(0);
    expect(game.avalanche).toEqual({ charge: 0, size: 1, phase: 'idle', timeLeft: 0 });
    expect(game.buffs).toEqual({ shield: false, starTimeLeft: 0, magnetTimeLeft: 0 });
    expect(game.path.phase).toBe('none');
    expect(game.path.offsetX).toBe(0);
    expect(payloadsOf(events, 'run:started')).toEqual([{ seed: 99 }, { seed: 7 }]);
  });
});

describe('startRun — popolamento iniziale del tronco', () => {
  it('subito dopo startRun il tronco non è vuoto e rispetta la zona franca', () => {
    const bus = createEventBus();
    const game = createGame(2026, bus);

    startRun(game);

    expect(game.entities.length).toBeGreaterThan(0);
    for (const entity of game.entities) {
      expect(entity.z).toBeGreaterThanOrEqual(CONFIG.world.spawnSafeZ);
    }
  });

  it('almeno il 90% delle run ha un ostacolo raggiungibile entro pochi secondi simulati (300 seed)', () => {
    // Diversamente dalla v1 (che aveva un popolamento delle righe iniziali
    // probabilistico, corretto con un "startBelt" forzato), lo spawner v2
    // piazza gli ostacoli a passo fisso fra minObstacleGap e maxObstacleGap
    // (nessun "tiro" di riempimento): la soglia qui è quindi una verifica di
    // integrazione, non una correzione di un buco statistico noto.
    const SEED_COUNT = 300;
    const REACH_SECONDS = 6;
    const reachZ = CONFIG.world.startSpeed * REACH_SECONDS;

    let withinReach = 0;
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const bus = createEventBus();
      const game = createGame(seed, bus);
      startRun(game);

      const hasObstacleAhead = game.entities.some(
        (entity) => entity.category === 'obstacle' && entity.z < reachZ,
      );
      if (hasObstacleAhead) withinReach += 1;
    }

    expect(withinReach / SEED_COUNT).toBeGreaterThanOrEqual(0.9);
  });

  it('resta deterministico: stesso seed produce le stesse entità iniziali', () => {
    function initialEntities(seed: number): Entity[] {
      const bus = createEventBus();
      const game = createGame(seed, bus);
      startRun(game);
      return game.entities.map((entity) => ({ ...entity }));
    }

    expect(initialEntities(2026)).toEqual(initialEntities(2026));
  });
});

describe('updateGame — simulazione lunga', () => {
  it('60 secondi a 1/60 con seed fisso non lanciano e le entità vive restano limitate', () => {
    const bus = createEventBus();
    const game = createGame(20260819, bus);
    startRun(game);

    let maxEntities = 0;

    expect(() => {
      for (let frame = 0; frame < 60 * 60; frame += 1) {
        updateGame(game, STEP);
        maxEntities = Math.max(maxEntities, game.entities.length);
        if (!game.alive) startRun(game);
      }
    }).not.toThrow();

    expect(maxEntities).toBeGreaterThan(0);
    // Tetto più largo che in v1: durante un bivio esistono temporaneamente
    // le entità di ENTRAMBI i rami, oltre a file di fiocchi più lunghe
    // (6..10 contro l'1 della v1).
    expect(maxEntities).toBeLessThan(300);
  });

  it('il giocatore che non fa nulla muore prima o poi, e run:ended arriva una sola volta', () => {
    const bus = createEventBus();
    const game = createGame(2026, bus);
    startRun(game);
    const events = recordEvents(bus);

    let frame = 0;
    while (game.alive && frame < 60 * 60) {
      updateGame(game, STEP);
      frame += 1;
    }

    expect(game.alive).toBe(false);
    expect(countOf(events, 'run:ended')).toBe(1);

    const total = events.length;
    runFrames(game, 30);
    expect(events).toHaveLength(total);
  });

  it('il punteggio non decresce mai finché il giocatore è vivo', () => {
    const bus = createEventBus();
    const game = createGame(4242, bus);
    startRun(game);

    let previous = game.score.points;
    let frames = 0;

    while (game.alive && frames < 60 * 30) {
      updateGame(game, STEP);
      expect(game.score.points).toBeGreaterThanOrEqual(previous);
      previous = game.score.points;
      frames += 1;
    }

    expect(frames).toBeGreaterThan(0);
    expect(game.score.points).toBeGreaterThan(0);
  });
});

describe('advanceWorldOnly', () => {
  it('fa avanzare world.distance anche con game.alive = false', () => {
    const bus = createEventBus();
    const game = createGame(2026, bus);
    startRun(game);
    game.alive = false;

    const distanceBefore = game.world.distance;
    advanceWorldOnly(game, 1);

    expect(game.world.distance).toBeGreaterThan(distanceBefore);
  });

  it('sposta le entità esistenti in avanti, senza generarne di nuove né assegnare punti', () => {
    const bus = createEventBus();
    const game = createGame(2026, bus);
    startRun(game);
    game.alive = false;
    const entityCountBefore = game.entities.length;
    const firstZBefore = game.entities[0]?.z;
    const pointsBefore = game.score.points;

    advanceWorldOnly(game, 0.1);

    expect(game.entities.length).toBeLessThanOrEqual(entityCountBefore);
    if (firstZBefore !== undefined && game.entities[0] !== undefined) {
      expect(game.entities[0].z).toBeLessThan(firstZBefore);
    }
    expect(game.score.points).toBe(pointsBefore);
  });

  it('non lancia mai su una simulazione lunga, anche con entità che escono dietro', () => {
    const bus = createEventBus();
    const game = createGame(99, bus);
    startRun(game);
    game.alive = false;

    expect(() => {
      for (let frame = 0; frame < 600; frame += 1) advanceWorldOnly(game, STEP);
    }).not.toThrow();
  });
});

describe('abandonRun', () => {
  it('emette run:stopped e segna la run come non più viva', () => {
    const bus = createEventBus();
    const game = createGame(2026, bus);
    startRun(game);
    const events = recordEvents(bus);
    expect(game.alive).toBe(true);

    abandonRun(game);

    expect(game.alive).toBe(false);
    expect(countOf(events, 'run:stopped')).toBe(1);
    expect(countOf(events, 'run:ended')).toBe(0);
  });

  it('è un no-op se la run non era già viva (nessun evento duplicato)', () => {
    const bus = createEventBus();
    const game = createGame(2026, bus);
    startRun(game);
    const events = recordEvents(bus);

    abandonRun(game);
    abandonRun(game);

    expect(countOf(events, 'run:stopped')).toBe(1);
  });
});

describe('updateGame — ostacoli a terra e sospesi', () => {
  it('un ostacolo a terra uccide chi resta fermo', () => {
    const { game, events } = scenario(1, groundObstacle());

    runFrames(game, 60);

    expect(game.alive).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['death']);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.branch)).toEqual(['main']);
    expect(countOf(events, 'run:ended')).toBe(1);

    const total = events.length;
    runFrames(game, 10);
    expect(events).toHaveLength(total);
    expect(countOf(events, 'run:ended')).toBe(1);
  });

  it('un ostacolo a terra si supera saltando', () => {
    const { game } = scenario(1, groundObstacle());

    handleAction(game, 'JUMP');
    runFrames(game, 60);

    expect(game.alive).toBe(true);
  });

  it('un ostacolo sospeso uccide chi resta in piedi a taglia massima', () => {
    const { game, events } = scenario(1, overheadObstacle());
    addCharge(game.avalanche, 80, game.bus);
    expect(game.avalanche.size).toBe(5);

    runFrames(game, 60);

    expect(game.alive).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['death']);
  });

  it('un ostacolo sospeso si supera scivolando, anche a taglia massima', () => {
    const { game } = scenario(1, overheadObstacle());
    addCharge(game.avalanche, 80, game.bus);
    expect(game.avalanche.size).toBe(5);

    handleAction(game, 'SLIDE');
    runFrames(game, 60);

    expect(game.alive).toBe(true);
  });

  it('con carica al 60% perdona il primo impatto invece di uccidere', () => {
    const { game, events } = scenario(1, groundObstacle());
    addCharge(game.avalanche, 60, game.bus);
    expect(game.avalanche.size).toBe(4);

    runFrames(game, 60);

    expect(game.alive).toBe(true);
    expect(game.forgivenessUsed).toBe(true);
    expect(game.avalanche.charge).toBe(0);
    expect(game.avalanche.size).toBe(4 - CONFIG.forgiveness.sizePenalty);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['forgiven']);
    expect(countOf(events, 'run:ended')).toBe(0);
    expect(game.entities).toHaveLength(0);
  });

  it('in fase valanga sfonda la roccia e incassa il bonus moltiplicato', () => {
    const { game, events } = scenario(1, groundObstacle());
    addCharge(game.avalanche, CONFIG.avalanche.threshold, game.bus);
    expect(game.avalanche.phase).toBe('active');

    runFrames(game, 60);

    expect(game.alive).toBe(true);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['smashed']);
    expect(game.score.points).toBeGreaterThanOrEqual(
      CONFIG.score.smashBonus * CONFIG.avalanche.scoreMultiplier,
    );
    expect(game.entities).toHaveLength(0);
  });

  it('con lo scudo attivo un impatto lo consuma e il giocatore sopravvive', () => {
    const { game, events } = scenario(11, groundObstacle());
    applyBuff(game.buffs, 'bell', game.bus);
    expect(game.buffs.shield).toBe(true);

    runFrames(game, 60);

    expect(game.alive).toBe(true);
    expect(game.buffs.shield).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['shielded']);
    expect(countOf(events, 'shield:consumed')).toBe(1);
  });

  it('senza scudo (e senza carica da perdonare) lo stesso impatto uccide', () => {
    const { game, events } = scenario(11, groundObstacle());

    runFrames(game, 60);

    expect(game.alive).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['death']);
  });
});

describe('updateGame — ramo non solido', () => {
  it("un'entità sul ramo non scelto non colpisce mai e i suoi fiocchi non si raccolgono", () => {
    const { game, events } = scenario(1, groundObstacle('right'));
    game.entities.push(snowflake('right', 6));
    expect(game.path.activeBranch).toBe('main');

    runFrames(game, 180);

    expect(game.alive).toBe(true);
    expect(countOf(events, 'obstacle:hit')).toBe(0);
    expect(countOf(events, 'pickup:collected')).toBe(0);
  });
});

describe('updateGame — bivio', () => {
  it('dopo che un bivio si risolve, nessuna entità del ramo scartato resta viva', () => {
    const bus = createEventBus();
    const game = createGame(1, bus);
    startRun(game);
    game.entities.length = 0;

    game.path.phase = 'approaching';
    game.path.forkZ = CONFIG.path.previewZ;
    game.path.choice = null;
    game.path.richBranch = 'right';
    game.path.activeBranch = 'main';
    game.path.offsetX = 0;
    game.path.nextForkIn = 999999;

    // Entrambi i rami popolati e visibili prima della scelta, come da design.
    game.entities.push(
      groundObstacle('left', CONFIG.path.previewZ - 5),
      snowflake('left', CONFIG.path.previewZ - 5),
      groundObstacle('right', CONFIG.path.previewZ - 5),
      snowflake('right', CONFIG.path.previewZ - 5),
    );

    let frame = 0;
    while ((game.path.phase as string) !== 'committed' && frame < 600) {
      updateGame(game, STEP);
      frame += 1;
    }

    expect(game.path.phase).toBe('committed');
    const chosen = game.path.activeBranch;
    expect(chosen === 'left' || chosen === 'right').toBe(true);
    const discarded: Branch = chosen === 'left' ? 'right' : 'left';

    expect(game.entities.some((entity) => entity.branch === discarded && entity.alive)).toBe(false);
  });

  it('la calamita raccoglie fiocchi che il giocatore non tocca direttamente', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);
    const events = recordEvents(bus);
    game.entities.length = 0;
    const farFlake = snowflake('main', CONFIG.buffs.magnetRangeZ - 1);
    game.entities.push(farFlake);
    applyBuff(game.buffs, 'magnet', game.bus);

    updateGame(game, STEP);

    expect(farFlake.alive).toBe(false);
    expect(payloadsOf(events, 'pickup:collected').map((p) => p.kind)).toEqual(['snowflake']);
  });
});

describe('determinismo', () => {
  it('due partite con lo stesso seed e le stesse azioni danno lo stesso punteggio', () => {
    function play(seed: number, frames: number): { points: number; distance: number; alive: boolean } {
      const bus = createEventBus();
      const game = createGame(seed, bus);
      startRun(game);

      for (let frame = 0; frame < frames; frame += 1) {
        if (frame % 53 === 0) handleAction(game, 'JUMP');
        if (frame % 71 === 0) handleAction(game, 'SLIDE');
        if (frame % 97 === 0) handleAction(game, 'CHOOSE_LEFT');
        if (frame % 131 === 0) handleAction(game, 'CHOOSE_RIGHT');
        updateGame(game, STEP);
        if (!game.alive) startRun(game, seed);
      }

      return { points: game.score.points, distance: game.score.distance, alive: game.alive };
    }

    const first = play(31337, 60 * 20);
    const second = play(31337, 60 * 20);

    expect(second).toEqual(first);
    expect(first.points).toBeGreaterThan(0);
  });
});

describe('handleAction', () => {
  it('instrada JUMP al salto', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);

    handleAction(game, 'JUMP');
    expect(game.player.airborne).toBe(true);
  });

  it('instrada SLIDE alla scivolata', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);

    handleAction(game, 'SLIDE');
    expect(game.player.sliding).toBe(true);
  });

  it('instrada CHOOSE_LEFT/CHOOSE_RIGHT alla scelta del bivio, solo quando c\'è un bivio da scegliere', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);

    handleAction(game, 'CHOOSE_LEFT');
    expect(game.path.choice).toBeNull();

    game.path.phase = 'approaching';
    handleAction(game, 'CHOOSE_LEFT');
    expect(game.path.choice).toBe('left');

    handleAction(game, 'CHOOSE_RIGHT');
    expect(game.path.choice).toBe('right');
  });

  it('ignora PAUSE, gestita fuori dal gioco', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);
    const before = { ...game.player };

    handleAction(game, 'PAUSE');

    expect(game.player).toEqual(before);
    expect(game.alive).toBe(true);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/game/game.test.ts`
Atteso: FAIL (import rotti e/o assert non soddisfatti contro l'attuale `game.ts`, ancora v1).

- [ ] **Step 3: Sistema `canSmash` in `src/game/avalanche.ts`**

```ts
// src/game/avalanche.ts — unica funzione toccata, resto del file invariato
export function canSmash(state: AvalancheState, kind: ObstacleKind): boolean {
  if (isInvulnerable(state)) return true;
  // 'tree' non è più un ObstacleKind in v2 (è scenografia laterale): resta
  // sfondabile fuori dalla valanga solo 'fence', l'unico kind smashable
  // della vecchia coppia rimasto nel tipo.
  if (kind !== 'fence') return false;
  return state.size >= CONFIG.avalanche.smashMinSize;
}
```

E in `src/game/avalanche.test.ts`, sostituisci le due `it` che referenziano kind inesistenti (`'tree'`, `'cabin'`):

```ts
  it('durante la valanga sfonda qualunque ostacolo', () => {
    const bus = createEventBus();
    const state = createAvalanche();
    addCharge(state, CONFIG.avalanche.threshold, bus);

    expect(canSmash(state, 'rock')).toBe(true);
    expect(canSmash(state, 'log')).toBe(true);
    expect(canSmash(state, 'fence')).toBe(true);
    expect(canSmash(state, 'crevasse')).toBe(true);
    expect(canSmash(state, 'branch')).toBe(true);
    expect(canSmash(state, 'arch')).toBe(true);
    expect(canSmash(state, 'cornice')).toBe(true);
  });

  it('fuori dalla valanga sfonda solo la staccionata, da taglia 3', () => {
    const bus = createEventBus();
    const state = createAvalanche();

    addCharge(state, 20, bus);
    expect(state.size).toBe(2);
    expect(canSmash(state, 'fence')).toBe(false);

    addCharge(state, 20, bus);
    expect(state.size).toBe(3);
    expect(canSmash(state, 'fence')).toBe(true);
    expect(canSmash(state, 'rock')).toBe(false);
    expect(canSmash(state, 'log')).toBe(false);
    expect(canSmash(state, 'crevasse')).toBe(false);
    expect(canSmash(state, 'branch')).toBe(false);
    expect(canSmash(state, 'arch')).toBe(false);
    expect(canSmash(state, 'cornice')).toBe(false);
  });
```

- [ ] **Step 4: Aggiorna `'obstacle:hit'` in `src/core/events.ts`**

```ts
// src/core/events.ts — stato finale dopo questo step
import type { Branch, BuffKind, ObstacleKind, PickupKind } from '../game/types';

export interface GameEvents {
  'run:started': { seed: number };
  'run:ended': { points: number; distance: number; isRecord: boolean };
  'run:stopped': Record<string, never>;
  'pickup:collected': { kind: PickupKind; charge: number };
  'fork:appeared': { richBranch: 'left' | 'right' };
  'fork:chosen': { side: 'left' | 'right' };
  'fork:resolved': { side: 'left' | 'right' };
  'obstacle:hit': {
    kind: ObstacleKind;
    outcome: 'death' | 'forgiven' | 'smashed' | 'shielded';
    branch: Branch;
    z: number;
  };
  'size:changed': { size: number; previous: number };
  'avalanche:triggered': { size: number };
  'avalanche:ending': Record<string, never>;
  'avalanche:ended': Record<string, never>;
  'buff:gained': { kind: BuffKind };
  'buff:expired': { kind: BuffKind };
  'shield:consumed': Record<string, never>;
}

export type EventName = keyof GameEvents;

export interface EventBus {
  on<K extends EventName>(name: K, handler: (payload: GameEvents[K]) => void): () => void;
  emit<K extends EventName>(name: K, payload: GameEvents[K]): void;
  clear(): void;
}
```

`Lane` esce dall'import: non serve più a nessuna chiave. Il resto del file (`AnyHandler`, `createEventBus`) è invariato.

- [ ] **Step 5: Riscrivi `src/game/game.ts`**

```ts
// src/game/game.ts
import type { EventBus } from '../core/events';
import { createRng, type Rng } from '../core/rng';
import {
  addCharge,
  applyForgivenessPenalty,
  canSmash,
  createAvalanche,
  scoreMultiplier,
  updateAvalanche,
  type AvalancheState,
} from './avalanche';
import {
  applyBuff,
  buffMultiplier,
  consumeShield,
  createBuffs,
  magnetActive,
  updateBuffs,
  type BuffState,
} from './buffs';
import { boxesOverlap, entityBox, playerBox, ENTITY_BOX } from './collisions';
import { CONFIG } from './config';
import {
  branchIsSolid,
  chooseBranch,
  createPath,
  updatePath,
  type ForkPhase,
  type PathState,
} from './path';
import { createPlayer, jump, slide, updatePlayer, type PlayerState } from './player';
import { addBonus, addDistance, createScore, saveRecord, type ScoreState } from './score';
import { createSpawner, type Spawner } from './spawner';
import { difficultyAt } from './speed';
import type { Action, Branch, Entity, EntityKind, ObstacleKind, PickupKind } from './types';
import { createWorld, updateWorld, type WorldState } from './world';

export interface GameState {
  /** Seed della run corrente: va in `run:started` e permette di rigiocarla identica. */
  seed: number;
  rng: Rng;
  bus: EventBus;
  world: WorldState;
  path: PathState;
  player: PlayerState;
  avalanche: AvalancheState;
  buffs: BuffState;
  score: ScoreState;
  spawner: Spawner;
  entities: Entity[];
  alive: boolean;
  forgivenessUsed: boolean;
}

/**
 * Semi-finestra lungo z entro cui vale la pena costruire le AABB. Derivata
 * dalle profondità dichiarate, non da un numero scelto a mano: a 40 u/s con
 * passo 1/60 un'entità si sposta di 0,67 unità per frame, quindi non può
 * saltare questa finestra senza essere testata.
 */
const MAX_ENTITY_DEPTH = Math.max(...Object.values(ENTITY_BOX).map((box) => box.depth));
const COLLISION_Z_WINDOW = CONFIG.player.depth + MAX_ENTITY_DEPTH;

function isPickupKind(kind: EntityKind): kind is PickupKind {
  return (
    kind === 'snowflake' || kind === 'crystal' || kind === 'star' || kind === 'magnet' || kind === 'bell'
  );
}

export function createGame(seed: number, bus: EventBus): GameState {
  const rng = createRng(seed);
  return {
    seed,
    rng,
    bus,
    world: createWorld(),
    path: createPath(),
    player: createPlayer(),
    avalanche: createAvalanche(),
    buffs: createBuffs(),
    score: createScore(),
    spawner: createSpawner(rng),
    entities: [],
    // Uno stato appena creato non è in corsa: serve startRun.
    alive: false,
    forgivenessUsed: false,
  };
}

export function startRun(game: GameState, seed?: number): void {
  if (seed !== undefined) game.seed = seed;

  game.rng = createRng(game.seed);
  game.spawner = createSpawner(game.rng);
  game.world = createWorld();
  game.path = createPath();
  game.player = createPlayer();
  game.avalanche = createAvalanche();
  game.buffs = createBuffs();
  game.score = createScore();
  game.entities.length = 0;
  game.alive = true;
  game.forgivenessUsed = false;

  // Il tronco esiste già (i chunk di world.ts) ma è vuoto: senza popolarlo
  // subito, il primo riciclo di chunk sarebbe l'unica occasione di
  // generazione e la partenza sarebbe un pendio vuoto per diversi secondi.
  const difficulty = difficultyAt(game.world.distance);
  const chunks = game.world.chunks;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) continue;
    game.spawner.populateSegment(chunk.z, CONFIG.world.chunkLength, difficulty, 'main', false, game.entities);
  }

  // Zona franca: nessuna entità nasce addosso al giocatore.
  const spawnSafeZ = CONFIG.world.spawnSafeZ;
  for (let i = 0; i < game.entities.length; i++) {
    const entity = game.entities[i];
    if (entity !== undefined && entity.z < spawnSafeZ) entity.alive = false;
  }
  compactEntities(game.entities);

  game.bus.emit('run:started', { seed: game.seed });
}

/**
 * Interrompe la run corrente SENZA che sia stata una morte: es. il giocatore
 * torna al menu mentre è ancora vivo. Emette 'run:stopped', non 'run:ended'
 * (riservato alla morte, fa scattare il rallentatore in main.ts).
 */
export function abandonRun(game: GameState): void {
  if (!game.alive) return;
  game.alive = false;
  game.bus.emit('run:stopped', {});
}

export function handleAction(game: GameState, action: Action): void {
  if (!game.alive) return;

  switch (action) {
    case 'CHOOSE_LEFT':
      chooseBranch(game.path, 'left');
      break;
    case 'CHOOSE_RIGHT':
      chooseBranch(game.path, 'right');
      break;
    case 'JUMP':
      jump(game.player);
      break;
    case 'SLIDE':
      slide(game.player);
      break;
    case 'PAUSE':
      // La pausa è una transizione della macchina a stati, non un'azione di gioco.
      break;
  }
}

export function updateGame(game: GameState, dt: number): void {
  if (!game.alive) return;

  const distanceBefore = game.world.distance;
  updateWorld(game.world, dt);
  const moved = game.world.distance - distanceBefore;

  // path: si cattura la fase (e il ramo attivo) PRIMA di aggiornare, perché
  // updatePath può farli scattare nello stesso frame e altrimenti perderemmo
  // il "prima" necessario a rilevare la transizione.
  const phaseBefore = game.path.phase;
  const activeBranchBefore = game.path.activeBranch;
  updatePath(game.path, moved, game.world.speed, game.rng, game.bus);

  updatePlayer(game.player, dt);
  updateAvalanche(game.avalanche, dt, game.bus);
  updateBuffs(game.buffs, dt, game.bus);

  // spawn: rifornimento di routine sul tronco, poi le eventuali transizioni
  // del bivio (nascita, risoluzione, chiusura) che sostituiscono o
  // rietichettano le entità coinvolte.
  const difficulty = difficultyAt(game.world.distance);
  const recycled = game.world.recycled;
  for (let i = 0; i < recycled.length; i++) {
    const chunk = recycled[i];
    if (chunk === undefined) continue;
    game.spawner.populateSegment(chunk.z, CONFIG.world.chunkLength, difficulty, 'main', false, game.entities);
  }
  handleForkTransitions(game, phaseBefore, activeBranchBefore, difficulty);

  // avanzamento entità
  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    entity.z -= moved;
    if (entity.z < CONFIG.world.despawnBehindZ) entity.alive = false;
  }

  // calamita
  applyMagnet(game);

  // collisioni: solo con entità il cui ramo è solido.
  const box = playerBox(game.player.y, game.avalanche.size, game.player.sliding);
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    if (!branchIsSolid(game.path, entity.branch)) continue;
    if (Math.abs(entity.z) > COLLISION_Z_WINDOW) continue;
    if (!boxesOverlap(box, entityBox(entity))) continue;

    resolveCollision(game, entity);
    if (!game.alive) break;
  }

  compactEntities(game.entities);

  // punteggio
  if (game.alive) {
    const multiplier = scoreMultiplier(game.avalanche) * buffMultiplier(game.buffs);
    addDistance(game.score, moved, multiplier);
  }
}

/**
 * Reagisce alle transizioni di fase del bivio appena avvenute in updatePath.
 * Le tre transizioni rilevanti:
 * - 'none' -> 'approaching': nasce un bivio. La finestra [0, previewZ] non è
 *   più tronco: le entità 'main' già lì (da un riciclo di chunk avvenuto
 *   prima, ignaro del bivio) vengono rimosse e la finestra viene ripopolata
 *   due volte, una per ramo.
 * - 'approaching' -> 'committed': la scelta è fissata. Le entità del ramo
 *   scartato vengono rimosse subito: nessun leak.
 * - da 'committed'/'realigning' a 'none': il bivio è chiuso, il ramo scelto
 *   è il nuovo tronco. Le sue entità sopravvissute vengono rietichettate
 *   'main', altrimenti branchIsSolid le renderebbe di nuovo inerti.
 */
function handleForkTransitions(
  game: GameState,
  phaseBefore: ForkPhase,
  activeBranchBefore: Branch,
  difficulty: number,
): void {
  const path = game.path;

  if (phaseBefore === 'none' && path.phase === 'approaching') {
    removeMainEntitiesAhead(game.entities, CONFIG.path.previewZ);
    const richLeft = path.richBranch === 'left';
    game.spawner.populateSegment(0, CONFIG.path.previewZ, difficulty, 'left', richLeft, game.entities);
    game.spawner.populateSegment(0, CONFIG.path.previewZ, difficulty, 'right', !richLeft, game.entities);
    return;
  }

  if (phaseBefore === 'approaching' && path.phase === 'committed') {
    const discarded: Branch = path.activeBranch === 'left' ? 'right' : 'left';
    removeEntitiesOnBranch(game.entities, discarded);
    return;
  }

  if (phaseBefore !== 'none' && path.phase === 'none') {
    relabelBranch(game.entities, activeBranchBefore, 'main');
  }
}

function removeMainEntitiesAhead(entities: Entity[], maxZ: number): void {
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    if (entity.branch === 'main' && entity.z <= maxZ) entity.alive = false;
  }
}

function removeEntitiesOnBranch(entities: Entity[], branch: Branch): void {
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    if (entity.branch === branch) entity.alive = false;
  }
}

function relabelBranch(entities: Entity[], from: Branch, to: Branch): void {
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined) continue;
    if (entity.branch === from) entity.branch = to;
  }
}

/** Raccoglie direttamente i fiocchi entro magnetRangeZ sul ramo solido: non
 *  c'è un numero di "velocità di trascinamento" in config, quindi la
 *  calamita raccoglie invece di trascinare (vedi Note di progetto). */
function applyMagnet(game: GameState): void {
  if (!magnetActive(game.buffs)) return;

  const rangeZ = CONFIG.buffs.magnetRangeZ;
  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    if (entity.kind !== 'snowflake') continue;
    if (entity.z < 0 || entity.z > rangeZ) continue;
    if (!branchIsSolid(game.path, entity.branch)) continue;
    collectPickup(game, entity, 'snowflake');
  }
}

/**
 * Fa avanzare solo il pendio e le posizioni delle entità esistenti, senza
 * collisioni, punteggio o nuova generazione: usata da main.ts durante il
 * rallentatore alla morte (game.alive è già false, updateGame non fa nulla).
 */
export function advanceWorldOnly(game: GameState, dt: number): void {
  const distanceBefore = game.world.distance;
  updateWorld(game.world, dt);
  const moved = game.world.distance - distanceBefore;

  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || !entity.alive) continue;
    entity.z -= moved;
    if (entity.z < CONFIG.world.despawnBehindZ) entity.alive = false;
  }
  compactEntities(game.entities);
}

function resolveCollision(game: GameState, entity: Entity): void {
  if (isPickupKind(entity.kind)) {
    collectPickup(game, entity, entity.kind);
    return;
  }
  hitObstacle(game, entity, entity.kind);
}

/**
 * 'star', 'magnet' e 'bell' passano da applyBuff (stato, non carica).
 * 'snowflake' e 'crystal' danno carica pura: nessuno stato in buffs.ts.
 */
function collectPickup(game: GameState, entity: Entity, kind: PickupKind): void {
  entity.alive = false;

  // Il moltiplicatore è letto prima di qualunque effetto: il pickup che fa
  // scattare la valanga vale ancora il moltiplicatore precedente.
  const multiplier = scoreMultiplier(game.avalanche) * buffMultiplier(game.buffs);
  addBonus(game.score, CONFIG.score.pickupBonus[kind], multiplier);

  if (kind === 'star' || kind === 'magnet' || kind === 'bell') {
    applyBuff(game.buffs, kind, game.bus);
    game.bus.emit('pickup:collected', { kind, charge: 0 });
    return;
  }

  const base = CONFIG.pickups.charge[kind];
  const chargeBefore = game.avalanche.charge;
  addCharge(game.avalanche, base, game.bus);
  game.bus.emit('pickup:collected', { kind, charge: game.avalanche.charge - chargeBefore });
}

function hitObstacle(game: GameState, entity: Entity, kind: ObstacleKind): void {
  const multiplier = scoreMultiplier(game.avalanche) * buffMultiplier(game.buffs);
  const branch = entity.branch;
  const z = entity.z;

  if (canSmash(game.avalanche, kind)) {
    entity.alive = false;
    addBonus(game.score, CONFIG.score.smashBonus, multiplier);
    game.bus.emit('obstacle:hit', { kind, outcome: 'smashed', branch, z });
    return;
  }

  if (consumeShield(game.buffs, game.bus)) {
    entity.alive = false;
    game.bus.emit('obstacle:hit', { kind, outcome: 'shielded', branch, z });
    return;
  }

  const chargeRatio = game.avalanche.charge / CONFIG.avalanche.threshold;
  const forgivable =
    CONFIG.forgiveness.enabled &&
    !game.forgivenessUsed &&
    chargeRatio >= CONFIG.forgiveness.minChargeRatio;

  if (forgivable) {
    game.forgivenessUsed = true;
    // L'ostacolo perdonato sparisce: altrimenti colpirebbe di nuovo il frame dopo.
    entity.alive = false;
    applyForgivenessPenalty(game.avalanche, game.bus);
    game.bus.emit('obstacle:hit', { kind, outcome: 'forgiven', branch, z });
    return;
  }

  game.alive = false;
  game.bus.emit('obstacle:hit', { kind, outcome: 'death', branch, z });

  const isRecord = saveRecord(game.score.points);
  game.bus.emit('run:ended', {
    points: game.score.points,
    distance: game.score.distance,
    isRecord,
  });
}

/** Compattazione a due indici, in place: nessun array nuovo per frame. */
function compactEntities(entities: Entity[]): void {
  let write = 0;
  for (let read = 0; read < entities.length; read += 1) {
    const entity = entities[read];
    if (entity === undefined || !entity.alive) continue;
    if (write !== read) entities[write] = entity;
    write += 1;
  }
  entities.length = write;
}
```

- [ ] **Step 6: Aggiorna `CONFIG.score.pickupBonus` in `src/game/config.ts`**

```ts
  score: {
    pointsPerUnit: 1,
    // Bonus in punti per raccolta, indipendenti dalla carica che il pickup dà
    // alla valanga (quella è in pickups.charge). Non specificati dal
    // contratto: scelti qui in ordine di rarità (design doc §7), scudo (il
    // più raro) in cima.
    pickupBonus: { snowflake: 5, crystal: 15, star: 20, magnet: 20, bell: 30 },
    smashBonus: 30,
    recordKey: 'rollingcows.record',
  },
```

- [ ] **Step 7: Aggiorna il consumatore in `src/main.ts`**

L'evento `'obstacle:hit'` non ha più `lane`/`kind === 'cabin' ? 2 : 1`: la posizione laterale ora si calcola con `branchOffsetX` da `path.ts`. Sostituisci:

```ts
// prima
import { entityCenterX } from './game/lanes';
```

con:

```ts
// dopo
import { branchOffsetX } from './game/path';
```

e sostituisci l'handler:

```ts
// prima
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
```

con:

```ts
// dopo
  bus.on('obstacle:hit', (payload) => {
    const hitX = worldToViewX(branchOffsetX(game.path, payload.branch) + game.path.offsetX);

    if (payload.outcome === 'smashed' || payload.outcome === 'forgiven' || payload.outcome === 'shielded') {
      burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, CONFIG.feel.smashBurstPower * particleScale);
      view.shake(CONFIG.feel.impactShake);
      return;
    }
    // morte: l'ostacolo si disintegra subito, la mucca segue al via del rallentatore.
    burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, CONFIG.feel.deathBurstPower * particleScale);
    view.shake(CONFIG.feel.impactShake);
  });
```

`src/audio/audio.ts` NON necessita modifiche: il suo handler di `'obstacle:hit'` legge solo `outcome` (confrontato con la stringa `'death'`) e non referenzia `lane`, quindi resta valido con il nuovo tipo.

- [ ] **Step 8: Esegui i test e verifica lo stato finale**

Comando: `npm run test:run`
Atteso: PASS su tutti i file sotto `src/core/**` e `src/game/**`, incluso `src/game/game.test.ts` e `src/game/avalanche.test.ts`.

Comando: `npm run typecheck`
Atteso: **nessun errore in `src/core/**`, `src/game/**` e in `src/main.ts` limitatamente al punto toccato allo Step 7.** Possono restare errori in `src/render/entities-view.ts` (referenzia ancora `entity.lane`/`entity.width`, campi rimossi da `Entity`) e in altri file della sezione "Vista" del contratto (`player-view.ts`, `terrain.ts`, `models.ts`, `gesture.ts`, `hud.ts`) che non modellano ancora i nuovi kind (`log`, `arch`, `cornice`, `crystal`, `star`, `magnet`, `bell`) o il nuovo modello a rami: sono task successivi, non compresi in questo blocco, e questo step lo dichiara esplicitamente invece di nasconderlo dietro un "tutto verde" non vero.

File di test v1 eliminati nel frattempo perché testavano meccaniche non più esistenti:
- `src/game/lanes.test.ts` — rimosso insieme a `src/game/lanes.ts` da uno dei Task 1–5 (il concetto di corsia non esiste più in v2).

Nessun altro file di test è stato eliminato: `player.test.ts`, `collisions.test.ts` e `spawner.test.ts` sono stati riscritti (non eliminati) dai Task 1–5 per adattarsi alle nuove firme; `avalanche.test.ts` è stato corretto qui, allo Step 3, non eliminato.

- [ ] **Step 9: Commit**

```bash
git add src/game/game.ts src/game/game.test.ts src/game/avalanche.ts src/game/avalanche.test.ts src/game/config.ts src/core/events.ts src/main.ts
git commit -m "feat(game): rebuild orchestrator for the branching path, buffs and shield"
```

---

### Task 8: Nuovi modelli voxel — ostacoli del bivio e i quattro buff

**Files:**
- Modify: `src/render/models.ts`
- Modify: `src/render/models.test.ts`

**Interfaces:**
- Consumes: `EntityKind` da `src/game/types.ts`; `CONFIG.render.voxelSize`, `CONFIG.world.trackWidth` da `src/game/config.ts`.
- Produces:
  - `const MODELS: Record<'cow' | 'cabin' | 'tree' | 'hay' | EntityKind, VoxelModel>` (estende la mappa esistente)
  - sette nuove funzioni interne: `buildLog`, `buildArch`, `buildCornice`, `buildCrystal`, `buildStar`, `buildMagnet`, `buildBell`
  - sette nuovi colori di palette (indici 13-19)

**Cosa cambia e cosa no.** `cow`, `cabin`, `tree`, `hay` restano esattamente come sono: non sono più entità di gioco (`EntityKind` non le contiene più), ma restano modelli disponibili — la mucca del giocatore usa `cow`, e gli altri tre restano pronti per la scenografia laterale (fuori dallo scope di questi cinque task: nessun modulo qui li istanzia ancora). `rock`, `fence`, `crevasse`, `branch`, `snowflake` restano invariati: sono ancora `EntityKind` in v2. Si aggiungono solo i sette modelli mancanti richiesti dal nuovo `EntityKind` (`log`, `arch`, `cornice` fra gli ostacoli; `crystal`, `star`, `magnet`, `bell` fra i buff).

**Perché i buff hanno colori nuovi in palette.** La palette attuale (13 colori) non contiene nulla di sufficientemente saturo e distinto per quattro raccoglibili speciali: `ICE` (0x9fd8ff) è già presa dal crepaccio e dal fiocco, `HAY`/`WOOD` sono terrosi. Si aggiungono due coppie di colori (un tono principale più un accento chiaro) per cristallo e stella, e due tinte metalliche per calamita e campanaccio: quattro famiglie di colore diverse fra loro e da tutte quelle già usate dagli ostacoli, verificato da un test che confronta i colori dominanti.

- [ ] **Step 1: Aggiorna il test (fallente) di `models.ts`**

Sostituisci l'intero contenuto di `src/render/models.test.ts` con:

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import type { EntityKind } from '../game/types';
import { MODELS, PALETTE, buildGeometry, type VoxelModel } from './models';

type ModelKind = 'cow' | 'cabin' | 'tree' | 'hay' | EntityKind;

const ALL_KINDS: readonly ModelKind[] = [
  'cow', 'cabin', 'tree', 'hay',
  'rock', 'log', 'fence', 'crevasse', 'branch', 'arch', 'cornice',
  'snowflake', 'crystal', 'star', 'magnet', 'bell',
];

const OBSTACLE_KINDS = ['rock', 'log', 'fence', 'crevasse', 'branch', 'arch', 'cornice'] as const;
const BUFF_KINDS = ['crystal', 'star', 'magnet', 'bell'] as const;

function solidCube(size: number, colorIndex = 0): VoxelModel {
  const voxels: number[][] = [];
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let z = 0; z < size; z += 1) voxels.push([x, y, z, colorIndex]);
    }
  }
  return { voxels, palette: PALETTE };
}

function faceCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  expect(index).not.toBeNull();
  return (index?.count ?? 0) / 6;
}

/** Il colore più frequente di un modello: usato per verificare che i buff si
 *  distinguano a colpo d'occhio, non solo che abbiano una palette diversa. */
function dominantColorHex(kind: ModelKind): number {
  const model = MODELS[kind];
  const counts = new Map<number, number>();
  for (const voxel of model.voxels) {
    const index = voxel[3] ?? 0;
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = -1;
  for (const [index, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = index;
    }
  }
  return model.palette[best] ?? 0;
}

describe('buildGeometry — omissione delle facce interne', () => {
  it('un cubo pieno 2x2x2 genera esattamente 24 facce esterne e nessuna interna', () => {
    const geometry = buildGeometry(solidCube(2), 1);
    expect(faceCount(geometry)).toBe(24);
    expect(geometry.getAttribute('position').count).toBe(24 * 4);
    expect(geometry.getIndex()?.count).toBe(24 * 6);
  });

  it('un cubo pieno 3x3x3 espone solo la superficie: 54 facce, il cubetto centrale sparisce', () => {
    const geometry = buildGeometry(solidCube(3), 1);
    expect(faceCount(geometry)).toBe(6 * 9);
  });

  it('un singolo cubetto isolato ha tutte e 6 le facce', () => {
    const geometry = buildGeometry({ voxels: [[0, 0, 0, 0]], palette: PALETTE }, 1);
    expect(faceCount(geometry)).toBe(6);
  });
});

describe('buildGeometry — forma degli attributi', () => {
  it('ogni modello ha 4 vertici per faccia e 6 indici per faccia', () => {
    for (const kind of ALL_KINDS) {
      const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
      const faces = faceCount(geometry);
      expect(faces).toBeGreaterThan(0);
      expect(geometry.getAttribute('position').count).toBe(faces * 4);
      expect(geometry.getAttribute('normal').count).toBe(faces * 4);
      expect(geometry.getAttribute('color').count).toBe(faces * 4);
      expect(geometry.getIndex()?.count).toBe(faces * 6);
    }
  });

  it('nessun modello sfora il budget di triangoli per istanza', () => {
    for (const kind of ALL_KINDS) {
      const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
      expect(faceCount(geometry) * 2).toBeLessThan(4000);
    }
  });
});

describe('buildGeometry — centratura', () => {
  it('ogni modello è centrato su X e Z e appoggiato a y = 0', () => {
    for (const kind of ALL_KINDS) {
      const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
      const box = geometry.boundingBox;
      expect(box).not.toBeNull();
      if (box === null) continue;
      expect(box.min.x).toBeCloseTo(-box.max.x, 6);
      expect(box.min.z).toBeCloseTo(-box.max.z, 6);
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.y).toBeGreaterThan(0);
    }
  });

  it('la scala è quella di voxelSize', () => {
    const geometry = buildGeometry(solidCube(4), 0.25);
    const box = geometry.boundingBox;
    expect(box?.max.y).toBeCloseTo(1, 6);
    expect((box?.max.x ?? 0) - (box?.min.x ?? 0)).toBeCloseTo(1, 6);
  });
});

describe('MODELS', () => {
  it('espone un modello per ogni kind usato dal gioco, più le scenografie laterali', () => {
    for (const kind of ALL_KINDS) {
      expect(MODELS[kind].voxels.length).toBeGreaterThan(0);
    }
  });

  it('la mucca resta più stretta del tracciato', () => {
    const geometry = buildGeometry(MODELS.cow, CONFIG.render.voxelSize);
    const box = geometry.boundingBox;
    const width = (box?.max.x ?? 0) - (box?.min.x ?? 0);
    const depth = (box?.max.z ?? 0) - (box?.min.z ?? 0);
    expect(width).toBeLessThanOrEqual(CONFIG.world.trackWidth);
    expect(depth).toBeGreaterThan(width * 0.5);
  });
});

describe('palette', () => {
  it('i colori nei vertici corrispondono alla palette del modello', () => {
    const pinkIndex = 2;
    const geometry = buildGeometry({ voxels: [[0, 0, 0, pinkIndex]], palette: PALETTE }, 1);
    const expected = new THREE.Color().setHex(PALETTE[pinkIndex] ?? 0, THREE.SRGBColorSpace);
    const colors = geometry.getAttribute('color');
    expect(colors.count).toBe(24);
    for (let i = 0; i < colors.count; i += 1) {
      expect(colors.getX(i)).toBeCloseTo(expected.r, 6);
      expect(colors.getY(i)).toBeCloseTo(expected.g, 6);
      expect(colors.getZ(i)).toBeCloseTo(expected.b, 6);
    }
  });

  it('ogni indice colore usato dai modelli esiste nella palette', () => {
    for (const kind of ALL_KINDS) {
      const model = MODELS[kind];
      for (const voxel of model.voxels) {
        const index = voxel[3] ?? -1;
        expect(model.palette[index]).toBeTypeOf('number');
      }
    }
  });
});

describe('buff: riconoscibilità cromatica', () => {
  it('ogni buff ha un colore dominante diverso dagli altri tre', () => {
    const colors = BUFF_KINDS.map(dominantColorHex);
    for (let i = 0; i < colors.length; i += 1) {
      for (let j = i + 1; j < colors.length; j += 1) {
        expect(colors[i]).not.toBe(colors[j]);
      }
    }
  });

  it('il colore dominante di ogni buff non coincide con quello di nessun ostacolo', () => {
    const obstacleColors = OBSTACLE_KINDS.map(dominantColorHex);
    for (const buff of BUFF_KINDS) {
      expect(obstacleColors).not.toContain(dominantColorHex(buff));
    }
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/render/models.test.ts`
Atteso: FAIL — `MODELS['log']` (e `'arch'`, `'cornice'`, `'crystal'`, `'star'`, `'magnet'`, `'bell'`) è `undefined`, i test che iterano `ALL_KINDS` lanciano.

- [ ] **Step 3: Estendi la palette in `src/render/models.ts`**

Nel blocco `PALETTE`, aggiungi in coda (dopo `0x9fd8ff, // 12 ghiaccio`):

```ts
  0x2fe6d0, // 13 cristallo di ghiaccio (buff)
  0xd8fffa, // 14 riflesso del cristallo
  0xffcf3d, // 15 stella (buff), oro acceso
  0xfff3b0, // 16 nucleo della stella, oro chiaro
  0xe6483c, // 17 calamita (buff), rosso
  0xd7dde3, // 18 punte della calamita, acciaio
  0xc98f36, // 19 campanaccio (buff), ottone
];
```

e, subito dopo il blocco delle costanti `SNOW`..`ICE`, aggiungi:

```ts
const CRYSTAL = 13;
const CRYSTAL_LIGHT = 14;
const GOLD = 15;
const GOLD_LIGHT = 16;
const MAGNET_RED = 17;
const STEEL = 18;
const BRASS = 19;
```

- [ ] **Step 4: Aggiungi i sette nuovi builder**

Subito dopo `buildHay` (e prima del commento su `MODELS`), aggiungi:

```ts
/** Tronco caduto: cilindro orizzontale, con gli anelli di crescita segnati
 *  ai due tagli e due monconi di rami spezzati sul dorso. */
function buildLog(): VoxelModel {
  const b = createBuilder();
  const half = 7;
  const ry = 2;
  const rz = 2;
  for (let x = -half; x <= half; x += 1) {
    for (let y = 0; y <= ry * 2; y += 1) {
      for (let z = -rz; z <= rz; z += 1) {
        const dy = (y - ry) / (ry + 0.5);
        const dz = z / (rz + 0.5);
        if (dy * dy + dz * dz > 1) continue;
        const cutEnd = x === -half || x === half;
        const ring = Math.round(Math.hypot(y - ry, z)) % 2 === 0;
        b.set(x, y, z, cutEnd && ring ? LIGHT_WOOD : WOOD);
      }
    }
  }
  b.box(-3, ry * 2, -1, 1, 2, 2, WOOD);
  b.box(2, ry * 2, -1, 1, 2, 2, WOOD);
  return b.build();
}

/**
 * Arco di roccia: architrave che si ispessisce verso il centro. È SOLO
 * l'architrave (nessun pilastro): come `branch`, il modello vive vicino a
 * y = 0 nel proprio spazio locale, e la vista lo alza in quota con
 * `entity.y` (CONFIG.spawn.overheadY). Un pilastro che tocchi terra andrebbe
 * disegnato appeso a mezz'aria per qualunque `entity.y` diverso da 0, che è
 * esattamente il difetto da evitare.
 */
function buildArch(): VoxelModel {
  const b = createBuilder();
  const half = 8;
  for (let x = -half; x <= half; x += 1) {
    const rise = Math.round(Math.cos((x / half) * (Math.PI / 2)) * 2);
    const thickness = 2 + rise;
    for (let y = 0; y < thickness; y += 1) {
      for (let z = -2; z <= 2; z += 1) {
        b.set(x, y, z, (x + y + z) % 4 === 0 ? ROCK_DARK : ROCK);
      }
    }
  }
  return b.build();
}

/** Cornicione di ghiaccio: mensola larga con una fila di ghiaccioli di
 *  lunghezza variabile che pendono verso il basso. */
function buildCornice(): VoxelModel {
  const b = createBuilder();
  const half = 8;
  b.box(-half, 2, -2, half * 2 + 1, 2, 4, ICE);
  for (let x = -half + 1; x <= half - 1; x += 2) {
    const spike = 1 + (Math.abs(x * 7) % 3);
    for (let d = 0; d < spike; d += 1) {
      b.set(x, 1 - d, 0, ICE);
    }
  }
  return b.build();
}

/** Cristallo di ghiaccio (buff): tre schegge affusolate di taglia diversa,
 *  a sezione romboidale, con la punta più chiara. */
function buildCrystal(): VoxelModel {
  const b = createBuilder();
  const shards: readonly [number, number, number][] = [
    [0, 0, 5],
    [-2, 0, 3],
    [2, 1, 4],
  ];
  for (const [ox, oz, height] of shards) {
    for (let y = 0; y < height; y += 1) {
      const radius = Math.max(1, Math.round((height - y) * 0.4));
      for (let x = -radius; x <= radius; x += 1) {
        for (let z = -radius; z <= radius; z += 1) {
          if (Math.abs(x) + Math.abs(z) > radius) continue;
          b.set(ox + x, y, oz + z, y === height - 1 ? CRYSTAL_LIGHT : CRYSTAL);
        }
      }
    }
  }
  return b.build();
}

/** Stella (buff): nucleo dorato con quattro punte lunghe (cardinali) e
 *  quattro corte (diagonali), come una scintilla a otto raggi. */
function buildStar(): VoxelModel {
  const b = createBuilder();
  b.box(-1, -1, -1, 3, 3, 3, GOLD_LIGHT);
  const long: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const short: readonly [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [dx, dy] of long) {
    for (let i = 1; i <= 4; i += 1) {
      b.set(dx * (i + 1), dy * (i + 1), 0, i === 4 ? GOLD_LIGHT : GOLD);
    }
  }
  for (const [dx, dy] of short) {
    for (let i = 1; i <= 2; i += 1) {
      b.set(dx * (i + 1), dy * (i + 1), 0, GOLD);
    }
  }
  return b.build();
}

/** Calamita a ferro di cavallo (buff): due gambe piene, una curva alla base
 *  che le unisce (più bassa verso il centro, per leggersi come un arco), e
 *  punte in acciaio sulle due gambe. */
function buildMagnet(): VoxelModel {
  const b = createBuilder();
  const legHeight = 6;
  b.box(-3, 0, -1, 2, legHeight, 2, MAGNET_RED);
  b.box(1, 0, -1, 2, legHeight, 2, MAGNET_RED);
  for (let x = -3; x <= 2; x += 1) {
    const dx = (x + 0.5) / 3;
    const height = Math.max(1, Math.round((1 - dx * dx) * 3));
    b.box(x, 0, -1, 1, height, 2, MAGNET_RED);
  }
  b.box(-3, legHeight, -1, 2, 1, 2, STEEL);
  b.box(1, legHeight, -1, 2, 1, 2, STEEL);
  return b.build();
}

/** Campanaccio (buff scudo): corpo troncopiramidale in ottone, maniglia e
 *  batacchio in vista sotto l'apertura. */
function buildBell(): VoxelModel {
  const b = createBuilder();
  for (let layer = 0; layer < 4; layer += 1) {
    const radius = Math.max(1, 3 - layer);
    for (let x = -radius; x <= radius; x += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        if (Math.abs(x) + Math.abs(z) > radius + 1) continue;
        b.set(x, layer, z, BRASS);
      }
    }
  }
  b.box(-1, 4, 0, 3, 1, 1, BLACK);
  b.set(-1, 5, 0, BLACK);
  b.set(1, 5, 0, BLACK);
  b.set(0, -1, 0, BLACK);
  return b.build();
}
```

- [ ] **Step 5: Estendi il tipo e la mappa `MODELS`**

Sostituisci il blocco finale (dal commento su `cow` fino alla chiusura di `MODELS`) con:

```ts
/**
 * `cow` resta per la mucca del giocatore e per l'eventuale scenografia
 * laterale: NON è più un raccoglibile (in v2 `PickupKind` non la contiene).
 * `cabin`, `tree` e `hay` restano per lo stesso motivo — scenografia, non
 * entità di gioco. Tutti gli altri kind sono gli `EntityKind` di v2.
 */
export const MODELS: Record<'cow' | 'cabin' | 'tree' | 'hay' | EntityKind, VoxelModel> = {
  cow: buildCow(),
  cabin: buildCabin(),
  tree: buildTree(),
  hay: buildHay(),
  rock: buildRock(),
  log: buildLog(),
  fence: buildFence(),
  crevasse: buildCrevasse(),
  branch: buildBranch(),
  arch: buildArch(),
  cornice: buildCornice(),
  snowflake: buildSnowflake(),
  crystal: buildCrystal(),
  star: buildStar(),
  magnet: buildMagnet(),
  bell: buildBell(),
};
```

e, in testa al file, aggiorna l'import:

```ts
import type { EntityKind } from '../game/types';
```

(`ObstacleKind`/`PickupKind` non servono più come import diretti: `EntityKind` li contiene entrambi.)

- [ ] **Step 6: Esegui i test e verifica che passino**

Comando: `npm run test:run -- src/render/models.test.ts`
Atteso: PASS, tutti i test verdi (16 modelli attesi, budget di triangoli rispettato, centratura corretta, colori dei buff distinti fra loro e dagli ostacoli).

Comando: `npm run typecheck`
Atteso: PASS (nessun altro file importa ancora i nuovi kind, quindi nessuna rottura a valle in questo task).

- [ ] **Step 7: Commit**

```bash
git add src/render/models.ts src/render/models.test.ts
git commit -m "feat(render): add voxel models for log, arch, cornice and the four buffs"
```

---

### Task 9: Rami e scivolata — `entities-view.ts` e `player-view.ts`

**Files:**
- Modify: `src/render/entities-view.ts`
- Create: `src/render/entities-view.test.ts`
- Modify: `src/render/player-view.ts`
- Create: `src/render/player-view.test.ts`
- Modify: `src/main.ts` (tre chiamate a `sync`, aggiornate alle nuove firme)

**Interfaces:**
- Consumes:
  - `PathState`, `branchOffsetX(path: PathState, branch: Branch): number` da `src/game/path.ts`
  - `Entity`, `EntityKind`, `Branch` da `src/game/types.ts`
  - `PlayerState` da `src/game/player.ts`
  - `CONFIG.player.slideHeightRatio`, `CONFIG.render.voxelSize` da `src/game/config.ts`
  - `worldToViewX` da `src/render/camera-rig.ts`; `MODELS`, `buildGeometry` da `src/render/models.ts`; `MAX_INSTANCES_PER_KIND`, `instanceCountFor` da `src/render/instancing.ts`
- Produces:
  - `entityWorldOffsetX(path: PathState, entity: Pick<Entity, 'branch'>): number`
  - `EntitiesView.sync(entities: Entity[], path: PathState): void`
  - `interface PlayerScale { x: number; y: number; z: number }`
  - `playerModelScale(size: number, sliding: boolean): PlayerScale`
  - `PlayerView.sync(player: PlayerState, size: number, speed: number, dt: number, shielded: boolean): void`

**Cosa non c'è più.** `Entity.lane`/`Entity.width` sono spariti: niente più `entityCenterX`/`lanes.ts`, niente più scala legata alla larghezza (in v2 ogni modello è disegnato alla sua taglia naturale, scala 1, salvo la crescita per taglia della mucca). `PlayerState.x` è sparito: la mucca del giocatore è sempre a x = 0 (è il ramo che si sposta, non lei), quindi `player-view.ts` non ha più bisogno di `worldToViewX` per la propria posizione.

- [ ] **Step 1: Scrivi il test che fallisce per `entities-view.ts`**

`src/render/entities-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import type { PathState } from '../game/path';
import { entityWorldOffsetX } from './entities-view';

function fixture(overrides: Partial<PathState> = {}): PathState {
  return {
    phase: 'none',
    forkZ: 0,
    choice: null,
    richBranch: 'left',
    activeBranch: 'main',
    offsetX: 0,
    nextForkIn: 100,
    ...overrides,
  };
}

describe('entityWorldOffsetX', () => {
  it('un\'entità sul ramo main resta sempre a offset 0, qualunque offsetX', () => {
    expect(entityWorldOffsetX(fixture(), { branch: 'main' })).toBe(0);
    expect(entityWorldOffsetX(fixture({ offsetX: -3.2 }), { branch: 'main' })).toBeCloseTo(-3.2, 6);
  });

  it('un\'entità sul ramo sinistro sta a -branchSeparation quando offsetX è 0', () => {
    const path = fixture({ phase: 'approaching' });
    const x = entityWorldOffsetX(path, { branch: 'left' });
    expect(x).toBeCloseTo(-CONFIG.path.branchSeparation, 6);
  });

  it('un\'entità sul ramo destro sta a +branchSeparation quando offsetX è 0', () => {
    const path = fixture({ phase: 'approaching' });
    const x = entityWorldOffsetX(path, { branch: 'right' });
    expect(x).toBeCloseTo(CONFIG.path.branchSeparation, 6);
  });

  it('durante il riallineamento l\'offsetX del percorso si somma alla posizione del ramo', () => {
    const path = fixture({ phase: 'committed', activeBranch: 'right', offsetX: -4 });
    const x = entityWorldOffsetX(path, { branch: 'right' });
    expect(x).toBeCloseTo(CONFIG.path.branchSeparation - 4, 6);
  });

  it('a riallineamento concluso (offsetX tornato a 0) il ramo scelto coincide col centro', () => {
    const path = fixture({ phase: 'none', activeBranch: 'main', offsetX: 0 });
    expect(entityWorldOffsetX(path, { branch: 'main' })).toBe(0);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/render/entities-view.test.ts`
Atteso: FAIL con `Failed to resolve import "./entities-view"` o, dopo aver toccato il file, con `entityWorldOffsetX is not exported`.

- [ ] **Step 3: Riscrivi `src/render/entities-view.ts`**

Sostituisci l'intero contenuto con:

```ts
import * as THREE from 'three';
import { CONFIG } from '../game/config';
import { branchOffsetX, type PathState } from '../game/path';
import type { Entity, EntityKind } from '../game/types';
import { worldToViewX } from './camera-rig';
import { MAX_INSTANCES_PER_KIND, instanceCountFor } from './instancing';
import { MODELS, buildGeometry } from './models';

export interface EntitiesView {
  sync(entities: Entity[], path: PathState): void;
  group: THREE.Group;
}

/**
 * Un'InstancedMesh per ogni EntityKind di v2. `cabin`, `tree`, `hay` e `cow`
 * NON sono più entità di gioco: restano modelli disponibili in models.ts,
 * questa vista non li istanzia.
 */
const ENTITY_KINDS: readonly EntityKind[] = [
  'rock', 'log', 'fence', 'crevasse', 'branch', 'arch', 'cornice',
  'snowflake', 'crystal', 'star', 'magnet', 'bell',
];

/** Il crepaccio è complanare alla neve: un pelo sopra per non sfarfallare. */
const CREVASSE_Y_BIAS = 0.02;

/** Tipi che proiettano ombra: gli ostacoli sì; i raccoglibili — piccoli e
 *  spesso numerosi in fila — no, per risparmiare draw call di shadow map
 *  senza perdita percepibile. */
const CASTS_SHADOW: Record<EntityKind, boolean> = {
  rock: true,
  log: true,
  fence: true,
  crevasse: false,
  branch: true,
  arch: true,
  cornice: true,
  snowflake: false,
  crystal: false,
  star: false,
  magnet: false,
  bell: false,
};

function nowSeconds(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
}

/**
 * Scostamento laterale di MONDO (non ancora convertito in coordinate vista)
 * a cui va disegnata un'entità: dipende solo dal suo ramo e dallo stato
 * corrente del percorso. Logica pura, testabile senza three — la
 * conversione in X di schermo resta a worldToViewX, chiamata solo in sync.
 */
export function entityWorldOffsetX(path: PathState, entity: Pick<Entity, 'branch'>): number {
  return branchOffsetX(path, entity.branch) + path.offsetX;
}

export function createEntitiesView(): EntitiesView {
  const group = new THREE.Group();
  // Un solo materiale per tutte le entità: i colori arrivano dai vertici,
  // quindi non c'è alcun motivo di cambiare stato fra un tipo e l'altro.
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const meshes = new Map<EntityKind, THREE.InstancedMesh>();
  const dummy = new THREE.Object3D();

  for (const kind of ENTITY_KINDS) {
    const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES_PER_KIND);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Il bounding volume di un InstancedMesh non segue le istanze: senza
    // questo, gli ostacoli sparirebbero appena la geometria base esce dal frustum.
    mesh.frustumCulled = false;
    mesh.castShadow = CASTS_SHADOW[kind];
    mesh.receiveShadow = false;
    mesh.count = 0;
    meshes.set(kind, mesh);
    group.add(mesh);
  }

  function sync(entities: Entity[], path: PathState): void {
    const time = nowSeconds();

    for (let k = 0; k < ENTITY_KINDS.length; k++) {
      const kind = ENTITY_KINDS[k];
      if (kind === undefined) continue;
      const mesh = meshes.get(kind);
      if (mesh === undefined) continue;

      const count = instanceCountFor(entities, kind, MAX_INSTANCES_PER_KIND);
      let index = 0;

      for (let e = 0; e < entities.length; e++) {
        if (index >= count) break;
        const entity = entities[e];
        // Le entità di un ramo non (ancora) attivo si disegnano comunque: è
        // il senso del bivio, mostrare cosa contiene ciascun ramo prima
        // della scelta. Il filtro per solidità (branchIsSolid) appartiene
        // alle collisioni/raccolta, non a questa vista.
        if (entity === undefined || !entity.alive || entity.kind !== kind) continue;

        const yBias = kind === 'crevasse' ? CREVASSE_Y_BIAS : 0;

        let yaw = 0;
        if (entity.category === 'pickup') yaw = time * 2.2;
        else if (kind === 'rock') yaw = (entity.id % 4) * (Math.PI / 2);

        dummy.position.set(
          worldToViewX(entityWorldOffsetX(path, entity)),
          entity.y + yBias,
          entity.z,
        );
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        index += 1;
      }

      mesh.count = index;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return { sync, group };
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Comando: `npm run test:run -- src/render/entities-view.test.ts`
Atteso: PASS, 5 test verdi.

- [ ] **Step 5: Scrivi il test che fallisce per `player-view.ts`**

`src/render/player-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { playerModelScale } from './player-view';

const SCALE_PER_SIZE = 0.18;

describe('playerModelScale', () => {
  it('a taglia 1 e senza scivolata la scala è uniforme e pari a 1', () => {
    expect(playerModelScale(1, false)).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('la taglia scala uniformemente le tre dimensioni fuori dalla scivolata', () => {
    const scale = playerModelScale(5, false);
    const expected = 1 + 4 * SCALE_PER_SIZE;
    expect(scale.x).toBeCloseTo(expected, 6);
    expect(scale.y).toBeCloseTo(expected, 6);
    expect(scale.z).toBeCloseTo(expected, 6);
  });

  it('in scivolata Y si schiaccia esattamente di slideHeightRatio rispetto alla base', () => {
    const base = 1 + 4 * SCALE_PER_SIZE;
    const scale = playerModelScale(5, true);
    expect(scale.y).toBeCloseTo(base * CONFIG.player.slideHeightRatio, 6);
  });

  it('in scivolata X e Z si allargano rispetto alla base, ma restano meno del doppio', () => {
    const base = 1 + 4 * SCALE_PER_SIZE;
    const scale = playerModelScale(5, true);
    expect(scale.x).toBeGreaterThan(base);
    expect(scale.x).toBeLessThan(base * 2);
    expect(scale.z).toBe(scale.x);
  });

  it('la scivolata non introduce mai una torsione laterale (X e Z restano uguali)', () => {
    for (const size of [1, 2, 3, 4, 5]) {
      const scale = playerModelScale(size, true);
      expect(scale.x).toBe(scale.z);
    }
  });
});
```

- [ ] **Step 6: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/render/player-view.test.ts`
Atteso: FAIL con `playerModelScale is not exported`.

- [ ] **Step 7: Riscrivi `src/render/player-view.ts`**

Sostituisci l'intero contenuto con:

```ts
import * as THREE from 'three';
import { CONFIG } from '../game/config';
import type { PlayerState } from '../game/player';
import { MODELS, buildGeometry } from './models';

export interface PlayerView {
  sync(player: PlayerState, size: number, speed: number, dt: number, shielded: boolean): void;
  group: THREE.Group;
}

/**
 * Crescita visiva per taglia. È una costante di resa, non di bilanciamento:
 * l'hitbox reale cresce secondo CONFIG.player.halfWidthPerSize e heightPerSize.
 */
const PLAYER_SCALE_PER_SIZE = 0.18;
/** Quanto il modello si allarga in scivolata, come frazione dell'altezza
 *  perduta: 0.5 vuol dire che metà del volume "schiacciato" via dall'altezza
 *  si ridistribuisce su larghezza e profondità — il classico squash-and-
 *  stretch, che evita che la mucca sembri solo compressa e basta. */
const SLIDE_WIDEN_RATIO = 0.5;
/** Velocità di rotazione (rad/s) dell'alone dello scudo: lenta, non deve
 *  distrarre dall'azione. */
const SHIELD_SPIN_SPEED = 1.4;
/** Quanto l'alone è più grande della sagoma della mucca (in scala). */
const SHIELD_SCALE = 1.35;
const SHIELD_COLOR = 0x9fd8ff;
const SHIELD_OPACITY = 0.32;

export interface PlayerScale {
  x: number;
  y: number;
  z: number;
}

/**
 * Fattore di scala (x, y, z) del modello dato la taglia e lo stato di
 * scivolata. Logica pura, testabile senza three: Y si schiaccia esattamente
 * di CONFIG.player.slideHeightRatio (la sagoma di collisione fa lo stesso,
 * vedi game/collisions.ts — playerBox), X e Z si allargano un poco per
 * compensare visivamente il volume perso.
 */
export function playerModelScale(size: number, sliding: boolean): PlayerScale {
  const base = 1 + (size - 1) * PLAYER_SCALE_PER_SIZE;
  if (!sliding) {
    return { x: base, y: base, z: base };
  }
  const lost = 1 - CONFIG.player.slideHeightRatio;
  const widened = base * (1 + lost * SLIDE_WIDEN_RATIO);
  return { x: widened, y: base * CONFIG.player.slideHeightRatio, z: widened };
}

export function createPlayerView(): PlayerView {
  const geometry = buildGeometry(MODELS.cow, CONFIG.render.voxelSize);
  const box = geometry.boundingBox;
  const halfHeight = box === null ? 0.5 : (box.max.y - box.min.y) / 2;

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  // Il modello poggia a y = 0: abbassandolo di mezza altezza, il centro
  // geometrico finisce esattamente sull'origine del perno (che ruota).
  mesh.position.y = -halfHeight;

  // Alone dello scudo: una sfera più grande della mucca, semitrasparente,
  // nascosta quando lo scudo non è attivo. Non è un contorno vero (che
  // richiederebbe un secondo passaggio con le normali invertite): questa
  // sfera "aurea" è la scelta più economica compatibile con il budget di
  // draw call, ed è comunque leggibile come "protezione attiva". È figlia
  // di `group`, non di `pivot`: non deve rotolare con la mucca, solo
  // ruotare lentamente per conto suo.
  const shieldGeometry = new THREE.SphereGeometry(1, 12, 8);
  const shieldMaterial = new THREE.MeshBasicMaterial({
    color: SHIELD_COLOR,
    transparent: true,
    opacity: SHIELD_OPACITY,
    depthWrite: false,
  });
  const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
  shield.visible = false;

  const pivot = new THREE.Group();
  pivot.add(mesh);
  const group = new THREE.Group();
  group.add(pivot);
  group.add(shield);

  let roll = 0;
  let shieldSpin = 0;

  function sync(player: PlayerState, size: number, speed: number, dt: number, shielded: boolean): void {
    const scale = playerModelScale(size, player.sliding);
    pivot.scale.set(scale.x, scale.y, scale.z);

    const radius = Math.max(halfHeight * scale.y, 0.001);
    // Segno POSITIVO, non invertirlo (era il difetto segnalato in v1: la
    // mucca sembrava rotolare all'indietro). Il mondo scorre verso la
    // camera lungo -z mentre la mucca resta ferma a schermo, come su un
    // tapis roulant: perché rotoli in avanti senza slittare, il suo punto
    // di contatto deve muoversi in accordo con quello scorrimento.
    roll = (roll + (speed * dt) / radius) % (Math.PI * 2);
    pivot.rotation.x = roll;

    // La mucca del giocatore è sempre a x = 0 in v2 (è il tracciato che si
    // sposta, non lei): nessun worldToViewX qui, a differenza di v1.
    group.position.set(0, player.y + radius, 0);

    shield.visible = shielded;
    if (shielded) {
      shieldSpin += dt * SHIELD_SPIN_SPEED;
      shield.rotation.y = shieldSpin;
      // L'alone segue la sagoma reale (compresa la scivolata): un raggio
      // fisso sembrerebbe fluttuante quando la mucca si appiattisce.
      shield.scale.set(scale.x * SHIELD_SCALE, scale.y * SHIELD_SCALE, scale.z * SHIELD_SCALE);
    }
  }

  return { sync, group };
}
```

- [ ] **Step 8: Esegui i test e verifica che passino**

Comando: `npm run test:run`
Atteso: PASS, tutti i test verdi compresi i nuovi di `entities-view` e `player-view`.

- [ ] **Step 9: Aggiorna le tre chiamate a `sync` in `src/main.ts`**

`entitiesView.sync(game.entities)` compare due volte in `main.ts` (nel ramo del rallentatore di morte e nel ramo di gioco normale): in ENTRAMBI i punti, sostituisci con:

```ts
      entitiesView.sync(game.entities, game.path);
```

E sostituisci l'unica chiamata a `playerView.sync`:

```ts
      playerView.sync(game.player, game.avalanche.size, game.world.speed, playing ? dt : 0);
```

con:

```ts
      playerView.sync(game.player, game.avalanche.size, game.world.speed, playing ? dt : 0, game.buffs.shield);
```

`terrain.sync(game.world)` resta INVARIATO in questo task: la sua firma cambia solo nel Task 10.

- [ ] **Step 10: Verifica finale del task**

Comando: `npm run typecheck && npm run test:run`
Atteso: entrambi PASS.

Verifica visiva (rinviata in parte al Task 12, quando `main.ts` orchestra anche bivi e buff, ma già osservabile ora avviando `npm run dev` e giocando una run): la mucca continua a rotolare esattamente come prima; quando raccoglie un cristallo/una stella/una calamita/un campanaccio, il rispettivo modello (Task 8) appare sul percorso al posto del vecchio fieno/mucca-raccoglibile; NON deve apparire alcun oggetto fluttuante scollegato dal suolo né alcun buco dove prima c'era un ostacolo. Non deve comparire nessun errore in console relativo a `MODELS[kind]` undefined.

- [ ] **Step 11: Commit**

```bash
git add src/render/entities-view.ts src/render/entities-view.test.ts src/render/player-view.ts src/render/player-view.test.ts src/main.ts
git commit -m "feat(render): draw entities on their branch offset and squash the cow while sliding"
```

---

### Task 10: Terreno che si biforca — `terrain.ts`

**Files:**
- Modify: `src/render/terrain.ts`
- Modify: `src/render/terrain.test.ts`
- Modify: `src/main.ts` (le due chiamate a `terrain.sync`)

**Interfaces:**
- Consumes: `WorldState` da `src/game/world.ts` (invariato); `PathState`, `branchOffsetX` da `src/game/path.ts`; `CONFIG.world.trackWidth/chunkLength/chunkCount`, `CONFIG.path.branchSeparation` da `src/game/config.ts`.
- Produces:
  - `heightAt(x: number, z: number): number` (firma invariata, zona piatta allargata)
  - `trackCenterOffsets(path: PathState, z: number): readonly [number, number]`
  - `TerrainView.sync(world: WorldState, path: PathState): void`

**Il problema e la soluzione scelta.** Il vecchio corridoio piatto era una fascia FISSA larga `laneCount * laneWidth`. In v2 la fascia che deve restare piatta non è più fissa: durante un bivio i due rami vivono a `±CONFIG.path.branchSeparation`, quindi il terreno DEVE essere piatto anche lì, non solo al centro — altrimenti un ramo secondario affonderebbe nella neve rialzata, lo stesso difetto già corretto una volta in v1 (vedi il commento storico in `createChunkGeometry`, che resta e resta vero, solo con un numero diverso). La soluzione: la zona SEMPRE piatta si allarga in modo FISSO e permanente a `FLAT_HALF_WIDTH = CONFIG.path.branchSeparation + CONFIG.world.trackWidth / 2` (8 unità con la config attuale) — così `heightAt` resta una funzione pura di (x, z), senza bisogno di conoscere il percorso, e il pendio esterno (banchi compresi) resta un sistema statico a chunk esattamente come in v1, solo spostato più in fuori. Sopra questa base piatta e uniforme (tinta "neve non battuta", un po' più fredda) galleggia una SOLA mesh dinamica, "la pista": due nastri paralleli larghi `trackWidth`, ricalcolati ogni frame in base a `path` (colore "neve battuta", più chiaro). Fuori da un bivio i due nastri coincidono esattamente (un solo nastro visibile); durante un bivio, da `path.forkZ` in poi, si separano verso i due rami. Nessuna geometria a chunk deve più essere ricostruita: solo le X di questa piccola mesh dinamica cambiano, ogni frame, con una scrittura diretta nel buffer (zero allocazioni).

**Compromesso dichiarato.** La fascia sempre-piatta (±8) è più larga della vecchia corridoio (±3): fuori da un bivio si vedrà quindi un margine di neve piatta e "non battuta" più ampio prima che il pendio inizi a salire, non più i banchi quasi a ridosso della pista. È il prezzo per garantire l'invariante anche durante i bivi senza ricostruire la geometria a chunk a ogni frame: se in fase di verifica finale (Task 12) l'effetto sembra eccessivo, l'unico numero da toccare è `CONFIG.path.branchSeparation` (che è comunque fissato dal design a 6).

- [ ] **Step 1: Aggiorna il test (fallente) di `terrain.ts`**

Sostituisci l'intero contenuto di `src/render/terrain.test.ts` con:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import type { PathState } from '../game/path';
import { heightAt, trackCenterOffsets } from './terrain';

/** Stessa zona sempre-piatta calcolata in terrain.ts: la separazione dei
 *  rami più mezza larghezza del tracciato, così il pendio resta piatto sotto
 *  qualunque ramo, in qualunque momento di un bivio. */
const FLAT_HALF_WIDTH = CONFIG.path.branchSeparation + CONFIG.world.trackWidth / 2;
const LENGTH = CONFIG.world.chunkLength;

describe('heightAt', () => {
  it('è 0 dentro la zona sempre piatta, per qualunque z', () => {
    for (const z of [0, 5, LENGTH / 4, LENGTH / 2, LENGTH, LENGTH * 3.7]) {
      for (const x of [0, 0.5, 1, -1, 2, -2, FLAT_HALF_WIDTH, -FLAT_HALF_WIDTH]) {
        expect(heightAt(x, z)).toBe(0);
      }
    }
  });

  it('è continua al bordo della zona piatta: heightAt(±FLAT_HALF_WIDTH, z) = 0', () => {
    for (const z of [0, 13, LENGTH / 3, LENGTH]) {
      expect(heightAt(FLAT_HALF_WIDTH, z)).toBe(0);
      expect(heightAt(-FLAT_HALF_WIDTH, z)).toBe(0);
    }
  });

  it('resta vicina a zero appena fuori dalla zona piatta (continuità)', () => {
    for (const z of [0, LENGTH / 4, LENGTH / 2]) {
      const justOutside = heightAt(FLAT_HALF_WIDTH + 0.05, z);
      expect(Math.abs(justOutside)).toBeLessThan(0.02);
    }
  });

  it('non scende mai sotto un minimo prossimo a zero, in nessun punto', () => {
    let min = Infinity;
    for (let x = 0; x <= 130; x += 0.5) {
      for (let z = 0; z <= LENGTH; z += 1) {
        const h = heightAt(x, z);
        if (h < min) min = h;
      }
    }
    expect(min).toBeGreaterThan(-0.1);
  });

  it('satura al tetto (MAX_LATERAL_RISE) oltre una certa distanza laterale', () => {
    const farA = heightAt(60, 7);
    const farB = heightAt(120, 7);
    expect(Math.abs(farA - farB)).toBeLessThan(0.5);
  });

  it('è periodica su chunkLength: due chunk adiacenti combaciano', () => {
    for (const x of [10, 16, -30, 60]) {
      expect(heightAt(x, 0)).toBeCloseTo(heightAt(x, LENGTH), 10);
      expect(heightAt(x, 3.3)).toBeCloseTo(heightAt(x, 3.3 + LENGTH), 10);
    }
  });

  it('non supera mai il tetto teorico (~3.82 con la config di default)', () => {
    let max = -Infinity;
    for (let x = 0; x <= 130; x += 0.5) {
      for (let z = 0; z <= LENGTH; z += 1) {
        const h = heightAt(x, z);
        if (h > max) max = h;
      }
    }
    expect(max).toBeLessThan(4);
  });
});

function fixture(overrides: Partial<PathState> = {}): PathState {
  return {
    phase: 'none',
    forkZ: 0,
    choice: null,
    richBranch: 'left',
    activeBranch: 'main',
    offsetX: 0,
    nextForkIn: 100,
    ...overrides,
  };
}

describe('trackCenterOffsets', () => {
  it('senza bivio, i due nastri coincidono sempre a offsetX', () => {
    const path = fixture({ offsetX: 1.5 });
    for (const z of [0, 10, 90, 200]) {
      expect(trackCenterOffsets(path, z)).toEqual([1.5, 1.5]);
    }
  });

  it('con un bivio in corso ma prima della biforcazione (z <= forkZ), resta un solo nastro', () => {
    const path = fixture({ phase: 'approaching', forkZ: 40, offsetX: 0 });
    expect(trackCenterOffsets(path, 0)).toEqual([0, 0]);
    expect(trackCenterOffsets(path, 40)).toEqual([0, 0]);
  });

  it('oltre la biforcazione (z > forkZ) i due nastri divergono ai due rami', () => {
    const path = fixture({ phase: 'approaching', forkZ: 40, offsetX: 0 });
    const [left, right] = trackCenterOffsets(path, 41);
    expect(left).toBeCloseTo(-CONFIG.path.branchSeparation, 6);
    expect(right).toBeCloseTo(CONFIG.path.branchSeparation, 6);
  });

  it('durante il riallineamento, offsetX si somma anche ai nastri divergenti', () => {
    const path = fixture({ phase: 'committed', forkZ: 5, offsetX: -2 });
    const [left, right] = trackCenterOffsets(path, 90);
    expect(left).toBeCloseTo(-CONFIG.path.branchSeparation - 2, 6);
    expect(right).toBeCloseTo(CONFIG.path.branchSeparation - 2, 6);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/render/terrain.test.ts`
Atteso: FAIL — `trackCenterOffsets is not exported`, e i test di `heightAt` falliscono comunque perché `CORRIDOR_HALF` in `terrain.ts` è ancora quello di v1.

- [ ] **Step 3: Riscrivi `src/render/terrain.ts`**

Sostituisci l'intero contenuto con:

```ts
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../game/config';
import { branchOffsetX, type PathState } from '../game/path';
import type { WorldState } from '../game/world';

export interface TerrainView {
  sync(world: WorldState, path: PathState): void;
  group: THREE.Group;
}

/** Neve non battuta: la base sempre-piatta che deve poter ospitare qualunque
 *  ramo, anche quando non è la pista "ufficiale" del momento. */
const VERGE_COLOR = 0xdce9f2;
/** Neve battuta: il colore della pista vera e propria, invariato da v1. */
const SNOW_COLOR = 0xf4fbff;
const BANK_WIDTH = 3;
const BANK_TILT = 0.3;
const SEGMENTS_Z = 24;
/** Segmenti in x per il PAVIMENTO piatto: 1 solo basta, è piatto per
 *  costruzione (non chiama mai displaceGround). */
const CORRIDOR_SEGMENTS_X = 1;
const OUTER_SEGMENTS_X = 32;

/**
 * Semilarghezza della zona SEMPRE piatta: non è più la sola larghezza del
 * tracciato (world.trackWidth), ma quella più la separazione massima di un
 * ramo durante un bivio (path.branchSeparation). Motivo: durante un bivio le
 * entità del ramo sinistro/destro vivono a ±branchSeparation (vedi
 * game/path.ts, branchOffsetX) e devono poter contare su suolo piatto tanto
 * quanto il tracciato centrale — altrimenti un ramo affonderebbe nella neve
 * rialzata, esattamente il difetto già corretto una volta in v1 (vedi il
 * commento storico più sotto, in createChunkGeometry). Restando una costante
 * FISSA (non dipendente dallo stato del bivio), heightAt resta una funzione
 * pura di (x, z) sola, e il pendio esterno resta un sistema statico a chunk
 * come in v1: solo la PISTA (vedi trackCenterOffsets più sotto) è dinamica.
 */
const FLAT_HALF_WIDTH = CONFIG.path.branchSeparation + CONFIG.world.trackWidth / 2;
const BANK_INNER_MARGIN = 2;
const BANK_OFFSET = FLAT_HALF_WIDTH + BANK_INNER_MARGIN + 0.9;
const BANK_HEIGHT = CONFIG.render.bankHeight;
const BANK_BOTTOM_Y = CONFIG.render.bankBottomY;
const GROUND_WIDTH = FLAT_HALF_WIDTH * 2 + CONFIG.render.groundExtraWidth;
const MAX_LATERAL_RISE = CONFIG.render.groundMaxLateralRise;
const WAVE_COEF = 2;
const RISE_COEF = 2.2;

/**
 * Altezza del pendio in un punto (x, z), fuori dalla zona sempre piatta: 0 se
 * |x| è dentro FLAT_HALF_WIDTH, cresce con la distanza laterale fino al
 * tetto MAX_LATERAL_RISE, modulata dall'ondulazione periodica in z. Logica
 * pura (nessun three.js): usata sia da displaceGround sia dai test.
 * NON è la fonte della piattezza della zona centrale — quella è garantita a
 * monte, in createChunkGeometry, dal fatto che il pavimento (corridorFloor)
 * è una geometria a parte che non chiama mai questa funzione.
 */
export function heightAt(x: number, z: number): number {
  const length = CONFIG.world.chunkLength;
  const lateral = Math.abs(x) / FLAT_HALF_WIDTH;
  const outside = Math.min(MAX_LATERAL_RISE, Math.max(0, lateral - 1));
  const wave =
    Math.sin((z / length) * Math.PI * 2) * 0.18 +
    Math.sin((z / length) * Math.PI * 6 + x * 0.6) * 0.09;
  return wave * outside * WAVE_COEF + outside * outside * RISE_COEF;
}

function displaceGround(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, heightAt(x, z));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function createChunkGeometry(): THREE.BufferGeometry {
  const length = CONFIG.world.chunkLength;
  const outerWidth = GROUND_WIDTH / 2 - FLAT_HALF_WIDTH;

  // BUG CORRETTO IN V1, INVARIANTE CONSERVATA IN V2: corridoio e rilievo
  // laterale sono geometrie SEPARATE apposta. Un'unica PlaneGeometry larga
  // quanto tutto il terreno, con pochi segmenti, interpolerebbe linearmente
  // fra il centro piatto e il rilievo esterno e "gonfierebbe" il pavimento
  // proprio al suo bordo (misurato una volta: fino a 1.165 contro lo 0
  // atteso). Qui il pavimento (verge, larghezza FLAT_HALF_WIDTH * 2) NON
  // chiama mai displaceGround/heightAt: resta piatto per costruzione, non
  // perché la formula valuti a 0 lì.
  const corridorFloor = new THREE.PlaneGeometry(FLAT_HALF_WIDTH * 2, length, CORRIDOR_SEGMENTS_X, 1);
  corridorFloor.rotateX(-Math.PI / 2);
  corridorFloor.translate(0, 0, length / 2);

  const leftOuter = new THREE.PlaneGeometry(outerWidth, length, OUTER_SEGMENTS_X, SEGMENTS_Z);
  leftOuter.rotateX(-Math.PI / 2);
  leftOuter.translate(-(FLAT_HALF_WIDTH + outerWidth / 2), 0, length / 2);
  displaceGround(leftOuter);

  const rightOuter = new THREE.PlaneGeometry(outerWidth, length, OUTER_SEGMENTS_X, SEGMENTS_Z);
  rightOuter.rotateX(-Math.PI / 2);
  rightOuter.translate(FLAT_HALF_WIDTH + outerWidth / 2, 0, length / 2);
  displaceGround(rightOuter);

  const leftBank = new THREE.BoxGeometry(BANK_WIDTH, BANK_HEIGHT, length, 1, 1, 2);
  leftBank.rotateZ(BANK_TILT);
  leftBank.translate(-BANK_OFFSET, BANK_BOTTOM_Y + BANK_HEIGHT / 2, length / 2);

  const rightBank = new THREE.BoxGeometry(BANK_WIDTH, BANK_HEIGHT, length, 1, 1, 2);
  rightBank.rotateZ(-BANK_TILT);
  rightBank.translate(BANK_OFFSET, BANK_BOTTOM_Y + BANK_HEIGHT / 2, length / 2);

  const merged = mergeGeometries([corridorFloor, leftOuter, rightOuter, leftBank, rightBank], false);
  if (merged === null) {
    throw new Error('Impossibile unire le geometrie del chunk di terreno');
  }
  corridorFloor.dispose();
  leftOuter.dispose();
  rightOuter.dispose();
  leftBank.dispose();
  rightBank.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Righe della pista dinamica: una ogni 4 unità, per tutta la profondità
 *  visibile. Più fine non cambierebbe la sagoma percepita (la pista resta
 *  dritta a tratti), più grosso arrotonderebbe visibilmente lo spigolo del
 *  bivio. */
const TRACK_SEGMENTS = 60;
const TRACK_DEPTH = CONFIG.world.chunkLength * CONFIG.world.chunkCount;
const TRACK_STEP = TRACK_DEPTH / TRACK_SEGMENTS;
/** Solleva la pista battuta appena sopra la neve non battuta sottostante,
 *  per evitare z-fighting quando i due nastri coincidono esattamente
 *  (fuori bivio, sono alla stessa X). */
const TRACK_Y_BIAS = 0.02;
const TRACK_ROWS = TRACK_SEGMENTS + 1;
const TRACK_VERTS_PER_RIBBON = TRACK_ROWS * 2;

/**
 * Scostamento laterale del CENTRO di ciascuno dei due nastri della pista, a
 * una distanza z data, secondo lo stato del percorso: coincidono (nastro
 * unico) prima della biforcazione o quando non c'è alcun bivio; si separano
 * ai due rami da path.forkZ in poi. Logica pura, testabile senza three.
 */
export function trackCenterOffsets(path: PathState, z: number): readonly [number, number] {
  if (path.phase === 'none' || z <= path.forkZ) {
    return [path.offsetX, path.offsetX];
  }
  return [
    branchOffsetX(path, 'left') + path.offsetX,
    branchOffsetX(path, 'right') + path.offsetX,
  ];
}

function createTrackGeometry(): THREE.BufferGeometry {
  const totalVerts = TRACK_VERTS_PER_RIBBON * 2;
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  for (let v = 0; v < totalVerts; v += 1) {
    normals[v * 3 + 1] = 1;
  }

  const indices: number[] = [];
  for (let ribbon = 0; ribbon < 2; ribbon += 1) {
    const base = ribbon * TRACK_VERTS_PER_RIBBON;
    for (let i = 0; i < TRACK_ROWS - 1; i += 1) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Half-width del tracciato: ogni nastro è largo trackWidth, centrato sul
 *  proprio centro corrente. */
const HALF_TRACK = CONFIG.world.trackWidth / 2;

function updateTrackGeometry(geometry: THREE.BufferGeometry, path: PathState): void {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < TRACK_ROWS; i += 1) {
    const z = i * TRACK_STEP;
    const [leftCenter, rightCenter] = trackCenterOffsets(path, z);
    const leftBase = i * 2;
    const rightBase = TRACK_VERTS_PER_RIBBON + i * 2;
    position.setXYZ(leftBase, leftCenter - HALF_TRACK, TRACK_Y_BIAS, z);
    position.setXYZ(leftBase + 1, leftCenter + HALF_TRACK, TRACK_Y_BIAS, z);
    position.setXYZ(rightBase, rightCenter - HALF_TRACK, TRACK_Y_BIAS, z);
    position.setXYZ(rightBase + 1, rightCenter + HALF_TRACK, TRACK_Y_BIAS, z);
  }
  position.needsUpdate = true;
}

export function createTerrain(): TerrainView {
  const geometry = createChunkGeometry();
  const material = new THREE.MeshLambertMaterial({ color: VERGE_COLOR });
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];

  for (let i = 0; i < CONFIG.world.chunkCount; i += 1) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.position.z = i * CONFIG.world.chunkLength;
    meshes.push(mesh);
    group.add(mesh);
  }

  const trackGeometry = createTrackGeometry();
  const trackMaterial = new THREE.MeshLambertMaterial({ color: SNOW_COLOR });
  const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
  trackMesh.receiveShadow = true;
  trackMesh.castShadow = false;
  group.add(trackMesh);

  function sync(world: WorldState, path: PathState): void {
    for (let i = 0; i < meshes.length; i += 1) {
      const mesh = meshes[i];
      const chunk = world.chunks[i];
      if (mesh === undefined || chunk === undefined) continue;
      mesh.position.z = chunk.z;
    }
    updateTrackGeometry(trackGeometry, path);
  }

  return { sync, group };
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run -- src/render/terrain.test.ts`
Atteso: PASS, tutti i test verdi (invariante di piattezza allargata + le quattro proprietà di `trackCenterOffsets`).

- [ ] **Step 5: Aggiorna le due chiamate a `terrain.sync` in `src/main.ts`**

Le due occorrenze di:

```ts
      terrain.sync(game.world);
```

diventano:

```ts
      terrain.sync(game.world, game.path);
```

- [ ] **Step 6: Verifica finale del task**

Comando: `npm run typecheck && npm run test:run`
Atteso: entrambi PASS.

Verifica visiva (`npm run dev`, giocare fino a incontrare un bivio):
- Cosa DEVI vedere: un'unica pista bianca (neve battuta) su un fondo leggermente più freddo/muto, esattamente come prima finché non compare un bivio; all'avvicinarsi di un bivio, oltre un certo punto davanti alla mucca la pista bianca si biforca in DUE nastri che si allontanano verso sinistra e destra, restando entrambi perfettamente piatti (nessun ostacolo del ramo secondario deve affondare o fluttuare); dopo la scelta, il ramo NON scelto smette di ricevere entità (Task 1-7) e la pista, superato il punto, torna a un solo nastro; i banchi di neve rialzati restano visibili più ai lati, esterni a entrambi i rami.
- Cosa NON devi vedere: buchi o triangoli mancanti dove la pista si separa; un ostacolo del ramo secondario che sembra "nel pendio" invece che sulla neve piatta; sfarfallio (z-fighting) fra i due nastri quando coincidono fuori da un bivio — se capita, il primo sospetto è `TRACK_Y_BIAS` troppo piccolo o il winding degli indici invertito (in tal caso la pista dinamica risulterebbe invisibile da sopra: scambiare l'ordine `a, c, b` / `b, c, d` con `a, b, c` / `b, d, c`).

- [ ] **Step 7: Commit**

```bash
git add src/render/terrain.ts src/render/terrain.test.ts src/main.ts
git commit -m "feat(render): widen the flat corridor and split the track into two ribbons at a fork"
```

---

### Task 11: Input a quattro gesti e indicatori HUD di bivio e buff

**Files:**
- Modify: `src/input/gesture.ts`
- Modify: `src/input/gesture.test.ts`
- Modify: `src/input/input.ts`
- Modify: `src/input/input.test.ts`
- Modify: `src/ui/hud.ts`
- Modify: `src/ui/hud.test.ts`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `Action` da `src/game/types.ts` (`'CHOOSE_LEFT' | 'CHOOSE_RIGHT' | 'JUMP' | 'SLIDE' | 'PAUSE'`); `CONFIG.input.*`.
- Produces:
  - `gestureToAction(dx: number, dy: number, dtMs: number): Action | null` (stessa firma, nuovi nomi restituiti)
  - `Hud.setBuffs(shield: boolean, starSeconds: number, magnetSeconds: number): void`
  - `Hud.setFork(richBranch: 'left' | 'right' | null): void`

**Cambio di nomi, non di logica.** Il riconoscimento del gesto (asse dominante, soglie di distanza e di durata) non cambia affatto: cambiano solo i nomi delle azioni prodotte, perché in v2 non si cambia più corsia ma si sceglie un ramo. `MOVE_LEFT`/`MOVE_RIGHT` diventano `CHOOSE_LEFT`/`CHOOSE_RIGHT`; `SLAM` diventa `SLIDE` (stesso gesto, verso il basso).

- [ ] **Step 1: Aggiorna il test (fallente) di `gesture.ts`**

Sostituisci l'intero contenuto di `src/input/gesture.test.ts` con:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { gestureToAction } from './gesture';

const LONG = CONFIG.input.swipeMinPixels * 3;
const FAST = CONFIG.input.swipeMaxMs / 2;

describe('gestureToAction', () => {
  it('riconosce uno swipe netto verso destra come CHOOSE_RIGHT', () => {
    expect(gestureToAction(LONG, 0, FAST)).toBe('CHOOSE_RIGHT');
  });

  it('riconosce uno swipe netto verso sinistra come CHOOSE_LEFT', () => {
    expect(gestureToAction(-LONG, 0, FAST)).toBe('CHOOSE_LEFT');
  });

  it('riconosce lo swipe verso l alto come JUMP (dy negativo in coordinate schermo)', () => {
    expect(gestureToAction(0, -LONG, FAST)).toBe('JUMP');
  });

  it('riconosce lo swipe verso il basso come SLIDE (dy positivo in coordinate schermo)', () => {
    expect(gestureToAction(0, LONG, FAST)).toBe('SLIDE');
  });

  it('ignora uno spostamento sotto la soglia minima in pixel', () => {
    const short = CONFIG.input.swipeMinPixels - 1;
    expect(gestureToAction(short, short, FAST)).toBeNull();
  });

  it('ignora un gesto troppo lento', () => {
    expect(gestureToAction(LONG, 0, CONFIG.input.swipeMaxMs + 1)).toBeNull();
  });

  it('sceglie l asse dominante in un gesto diagonale', () => {
    expect(gestureToAction(LONG, -LONG / 2, FAST)).toBe('CHOOSE_RIGHT');
    expect(gestureToAction(-LONG / 2, LONG, FAST)).toBe('SLIDE');
  });

  it('accetta un gesto esattamente alla soglia di distanza e di durata', () => {
    expect(gestureToAction(CONFIG.input.swipeMinPixels, 0, CONFIG.input.swipeMaxMs)).toBe('CHOOSE_RIGHT');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/input/gesture.test.ts`
Atteso: FAIL — `gestureToAction` restituisce ancora `'MOVE_RIGHT'`/`'SLAM'`.

- [ ] **Step 3: Aggiorna `src/input/gesture.ts`**

Sostituisci l'intero contenuto con:

```ts
import { CONFIG } from '../game/config';
import type { Action } from '../game/types';

/**
 * Traduce lo spostamento di un puntatore in un'azione di gioco.
 *
 * ATTENZIONE AL SEGNO: `dx`/`dy` sono in COORDINATE SCHERMO, dove l'asse Y
 * cresce verso il BASSO. Quindi:
 *   - dy < 0  => il dito è andato verso l'ALTO  => JUMP
 *   - dy > 0  => il dito è andato verso il BASSO => SLIDE
 * È l'errore di segno più comune in questo tipo di codice: qui è esplicito e
 * bloccato da un test.
 *
 * Vince l'asse dominante: se |dx| >= |dy| il gesto è orizzontale, altrimenti
 * verticale. La distanza considerata è quella dell'asse dominante, non la
 * diagonale: un gesto obliquo corto non deve passare per somma di componenti.
 *
 * Lo swipe orizzontale sceglie un ramo (CHOOSE_LEFT/CHOOSE_RIGHT): fuori da
 * un bivio non ha alcun effetto immediato, ma resta comunque il gesto
 * corretto da restituire — è compito della logica di gioco (game/path.ts)
 * decidere se in quel momento esiste un bivio da scegliere, non di questo
 * modulo, che resta un puro traduttore di gesti.
 *
 * Restituisce null se il gesto è troppo corto (< swipeMinPixels) o troppo
 * lento (> swipeMaxMs): in quel caso è un tap o un trascinamento, non uno swipe.
 */
export function gestureToAction(dx: number, dy: number, dtMs: number): Action | null {
  if (dtMs > CONFIG.input.swipeMaxMs) {
    return null;
  }

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const dominant = Math.max(absX, absY);

  if (dominant < CONFIG.input.swipeMinPixels) {
    return null;
  }

  if (absX >= absY) {
    return dx > 0 ? 'CHOOSE_RIGHT' : 'CHOOSE_LEFT';
  }

  return dy < 0 ? 'JUMP' : 'SLIDE';
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Comando: `npm run test:run -- src/input/gesture.test.ts`
Atteso: PASS, 8 test verdi.

- [ ] **Step 5: Aggiorna il test (fallente) di `input.ts`**

Sostituisci l'intero contenuto di `src/input/input.test.ts` con:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { createInput } from './input';

let now = 0;
const nowMs = (): number => now;

let target: HTMLElement;

beforeEach(() => {
  now = 0;
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  target.remove();
});

function pressKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function pointer(type: 'pointerdown' | 'pointerup', x: number, y: number): void {
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
}

describe('createInput', () => {
  it('traduce ArrowLeft in CHOOSE_LEFT e consuma il buffer una sola volta', () => {
    const input = createInput(target, nowMs);
    pressKey('ArrowLeft');

    expect(input.consume()).toBe('CHOOSE_LEFT');
    expect(input.consume()).toBeNull();

    input.dispose();
  });

  it('mappa i tasti di gioco sulle azioni astratte', () => {
    const input = createInput(target, nowMs);

    pressKey('ArrowRight');
    expect(input.consume()).toBe('CHOOSE_RIGHT');
    pressKey('d');
    expect(input.consume()).toBe('CHOOSE_RIGHT');
    pressKey(' ');
    expect(input.consume()).toBe('JUMP');
    pressKey('ArrowDown');
    expect(input.consume()).toBe('SLIDE');
    pressKey('Escape');
    expect(input.consume()).toBe('PAUSE');

    input.dispose();
  });

  it('scarta un azione più vecchia di bufferSeconds', () => {
    const input = createInput(target, nowMs);
    pressKey('ArrowLeft');

    now = CONFIG.input.bufferSeconds * 1000 + 1;

    expect(input.consume()).toBeNull();

    input.dispose();
  });

  it('mantiene un azione ancora dentro la finestra di buffer', () => {
    const input = createInput(target, nowMs);
    pressKey('ArrowLeft');

    now = CONFIG.input.bufferSeconds * 1000 - 1;

    expect(input.consume()).toBe('CHOOSE_LEFT');

    input.dispose();
  });

  it('un nuovo input sostituisce quello in buffer', () => {
    const input = createInput(target, nowMs);
    pressKey('ArrowLeft');
    pressKey('ArrowRight');

    expect(input.consume()).toBe('CHOOSE_RIGHT');
    expect(input.consume()).toBeNull();

    input.dispose();
  });

  it('riconosce uno swipe da puntatore sul target', () => {
    const input = createInput(target, nowMs);

    pointer('pointerdown', 200, 200);
    now = 80;
    pointer('pointerup', 200 + CONFIG.input.swipeMinPixels * 3, 205);

    expect(input.consume()).toBe('CHOOSE_RIGHT');

    input.dispose();
  });

  it('non intercetta la tastiera quando il focus è su un bottone (PARTI/RIGIOCA restano attivabili da tastiera)', () => {
    const input = createInput(target, nowMs);
    const button = document.createElement('button');
    document.body.appendChild(button);

    const event = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: button });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(input.consume()).toBeNull();

    button.remove();
    input.dispose();
  });

  it('dopo dispose nessun evento produce più azioni', () => {
    const input = createInput(target, nowMs);
    input.dispose();

    pressKey('ArrowLeft');
    pointer('pointerdown', 10, 10);
    now = 50;
    pointer('pointerup', 10 + CONFIG.input.swipeMinPixels * 3, 10);

    expect(input.consume()).toBeNull();
  });
});
```

- [ ] **Step 6: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/input/input.test.ts`
Atteso: FAIL — `KEY_ACTIONS` in `input.ts` produce ancora `MOVE_LEFT`/`MOVE_RIGHT`/`SLAM`.

- [ ] **Step 7: Aggiorna `KEY_ACTIONS` in `src/input/input.ts`**

Sostituisci il blocco:

```ts
const KEY_ACTIONS: Readonly<Record<string, Action>> = {
  ArrowLeft: 'MOVE_LEFT',
  a: 'MOVE_LEFT',
  A: 'MOVE_LEFT',
  ArrowRight: 'MOVE_RIGHT',
  d: 'MOVE_RIGHT',
  D: 'MOVE_RIGHT',
  ArrowUp: 'JUMP',
  w: 'JUMP',
  W: 'JUMP',
  ' ': 'JUMP',
  Spacebar: 'JUMP',
  ArrowDown: 'SLAM',
  s: 'SLAM',
  S: 'SLAM',
  Escape: 'PAUSE',
  Esc: 'PAUSE',
  p: 'PAUSE',
  P: 'PAUSE',
};
```

con:

```ts
const KEY_ACTIONS: Readonly<Record<string, Action>> = {
  ArrowLeft: 'CHOOSE_LEFT',
  a: 'CHOOSE_LEFT',
  A: 'CHOOSE_LEFT',
  ArrowRight: 'CHOOSE_RIGHT',
  d: 'CHOOSE_RIGHT',
  D: 'CHOOSE_RIGHT',
  ArrowUp: 'JUMP',
  w: 'JUMP',
  W: 'JUMP',
  ' ': 'JUMP',
  Spacebar: 'JUMP',
  ArrowDown: 'SLIDE',
  s: 'SLIDE',
  S: 'SLIDE',
  Escape: 'PAUSE',
  Esc: 'PAUSE',
  p: 'PAUSE',
  P: 'PAUSE',
};
```

e nel commento sopra il blocco, sostituisci "frecce + WASD, spazio per saltare" con "frecce + WASD (sinistra/destra scelgono un ramo, solo utile a un bivio), spazio per saltare".

- [ ] **Step 8: Esegui i test e verifica che passino**

Comando: `npm run test:run -- src/input/gesture.test.ts src/input/input.test.ts`
Atteso: PASS.

- [ ] **Step 9: Aggiorna il test (fallente) di `hud.ts`**

In `src/ui/hud.test.ts`, aggiungi in coda al blocco `describe('createHud', ...)` (subito prima della sua chiusura `});`, dopo il test `'setVisible nasconde e mostra il contenitore'`):

```ts

  it('setBuffs accende solo il badge dello scudo quando è attivo', () => {
    const hud = createHud(root);

    hud.setBuffs(true, 0, 0);
    expect(need('[data-buff="shield"]').classList.contains('hud__buff--active')).toBe(true);
    expect(need('[data-buff="star"]').classList.contains('hud__buff--active')).toBe(false);
    expect(need('[data-buff="magnet"]').classList.contains('hud__buff--active')).toBe(false);

    hud.setBuffs(false, 0, 0);
    expect(need('[data-buff="shield"]').classList.contains('hud__buff--active')).toBe(false);
  });

  it('setBuffs mostra il tempo residuo della stella, arrotondato per eccesso', () => {
    const hud = createHud(root);

    hud.setBuffs(false, 5.4, 0);
    const star = need('[data-buff="star"]');
    expect(star.classList.contains('hud__buff--active')).toBe(true);
    expect(need('[data-buff="star"] .hud__buff-time').textContent).toBe('6');

    hud.setBuffs(false, 0, 0);
    expect(star.classList.contains('hud__buff--active')).toBe(false);
  });

  it('setBuffs mostra il tempo residuo della calamita', () => {
    const hud = createHud(root);

    hud.setBuffs(false, 0, 3.2);
    const magnet = need('[data-buff="magnet"]');
    expect(magnet.classList.contains('hud__buff--active')).toBe(true);
    expect(need('[data-buff="magnet"] .hud__buff-time').textContent).toBe('4');
  });

  it('setFork evidenzia il ramo ricco e mostra il pannello solo quando c è un bivio', () => {
    const hud = createHud(root);
    const fork = need('.hud__fork');

    hud.setFork('left');
    expect(fork.classList.contains('hud__fork--visible')).toBe(true);
    expect(need('[data-side="left"]').classList.contains('hud__fork-side--rich')).toBe(true);
    expect(need('[data-side="right"]').classList.contains('hud__fork-side--rich')).toBe(false);

    hud.setFork('right');
    expect(need('[data-side="left"]').classList.contains('hud__fork-side--rich')).toBe(false);
    expect(need('[data-side="right"]').classList.contains('hud__fork-side--rich')).toBe(true);

    hud.setFork(null);
    expect(fork.classList.contains('hud__fork--visible')).toBe(false);
  });
```

- [ ] **Step 10: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/ui/hud.test.ts`
Atteso: FAIL — `hud.setBuffs`/`hud.setFork` non esistono, `need('[data-buff="shield"]')` lancia.

- [ ] **Step 11: Estendi `src/ui/hud.ts`**

Sostituisci l'intero contenuto con:

```ts
export interface Hud {
  setPoints(p: number): void;
  setCharge(ratio: number): void;
  setSize(size: number): void;
  setAvalanche(on: boolean, warning: boolean): void;
  /** Scudo acceso/spento, secondi residui di stella e calamita (0 o meno =
   *  badge spento). Stella e calamita possono essere attive insieme. */
  setBuffs(shield: boolean, starSeconds: number, magnetSeconds: number): void;
  /** Ramo ricco da evidenziare mentre un bivio è in lettura; null nasconde
   *  del tutto il pannello (nessun bivio in corso). */
  setFork(richBranch: 'left' | 'right' | null): void;
  /** L'HUD deve stare visibile SOLO in 'playing': senza questo, punteggio,
   *  barra di carica e taglia restano leggibili sopra menu, pausa e game
   *  over, spesso sovrapposti allo stesso numero mostrato dalla schermata. */
  setVisible(visible: boolean): void;
}

/**
 * HUD in HTML sopra al canvas. Non legge lo stato di gioco: riceve solo numeri
 * già pronti, così resta un consumatore passivo e testabile.
 *
 * L'intero HUD è `pointer-events: none` (vedi style.css): se catturasse i touch,
 * gli swipe non arriverebbero al canvas e il gioco sarebbe ingiocabile. Lo
 * stesso vale per i nuovi pannelli di buff e bivio: nessuno di essi deve mai
 * ricevere `pointer-events: auto`.
 */
export function createHud(root: HTMLElement): Hud {
  const container = document.createElement('div');
  container.className = 'hud';
  container.innerHTML = `
    <div class="hud__points">0</div>
    <div class="hud__charge"><div class="hud__charge-fill"></div></div>
    <div class="hud__size">TAGLIA 1</div>
    <div class="hud__buffs">
      <div class="hud__buff hud__buff--shield" data-buff="shield">SCUDO</div>
      <div class="hud__buff hud__buff--star" data-buff="star"><span class="hud__buff-time"></span>s ×2</div>
      <div class="hud__buff hud__buff--magnet" data-buff="magnet"><span class="hud__buff-time"></span>s CALAMITA</div>
    </div>
    <div class="hud__fork">
      <div class="hud__fork-side" data-side="left">SINISTRA</div>
      <div class="hud__fork-side" data-side="right">DESTRA</div>
    </div>
  `;
  root.appendChild(container);

  function need(selector: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(selector);
    if (el === null) {
      throw new Error(`Elemento mancante nel HUD: ${selector}`);
    }
    return el;
  }

  const pointsEl = need('.hud__points');
  const fillEl = need('.hud__charge-fill');
  const sizeEl = need('.hud__size');
  const shieldEl = need('[data-buff="shield"]');
  const starEl = need('[data-buff="star"]');
  const starTimeEl = need('[data-buff="star"] .hud__buff-time');
  const magnetEl = need('[data-buff="magnet"]');
  const magnetTimeEl = need('[data-buff="magnet"] .hud__buff-time');
  const forkEl = need('.hud__fork');
  const forkLeftEl = need('[data-side="left"]');
  const forkRightEl = need('[data-side="right"]');

  return {
    setPoints(p: number): void {
      // Math.floor, non Math.round: come dichiarato in game/score.ts, la vista
      // non deve mai mostrare un punto non ancora davvero guadagnato.
      pointsEl.textContent = String(Math.floor(p));
    },

    setCharge(ratio: number): void {
      const clamped = Math.max(0, Math.min(1, ratio));
      fillEl.style.width = `${Math.round(clamped * 1000) / 10}%`;
    },

    setSize(size: number): void {
      sizeEl.textContent = `TAGLIA ${Math.round(size)}`;
    },

    setAvalanche(on: boolean, warning: boolean): void {
      container.classList.toggle('hud--avalanche', on);
      container.classList.toggle('hud--warning', warning);
    },

    setBuffs(shield: boolean, starSeconds: number, magnetSeconds: number): void {
      shieldEl.classList.toggle('hud__buff--active', shield);

      const starOn = starSeconds > 0;
      starEl.classList.toggle('hud__buff--active', starOn);
      starTimeEl.textContent = starOn ? String(Math.ceil(starSeconds)) : '';

      const magnetOn = magnetSeconds > 0;
      magnetEl.classList.toggle('hud__buff--active', magnetOn);
      magnetTimeEl.textContent = magnetOn ? String(Math.ceil(magnetSeconds)) : '';
    },

    setFork(richBranch: 'left' | 'right' | null): void {
      forkEl.classList.toggle('hud__fork--visible', richBranch !== null);
      forkLeftEl.classList.toggle('hud__fork-side--rich', richBranch === 'left');
      forkRightEl.classList.toggle('hud__fork-side--rich', richBranch === 'right');
    },

    setVisible(visible: boolean): void {
      container.classList.toggle('hud--hidden', !visible);
    },
  };
}
```

- [ ] **Step 12: Esegui i test e verifica che passino**

Comando: `npm run test:run`
Atteso: PASS, tutti i test verdi.

- [ ] **Step 13: Stile dei nuovi pannelli in `src/style.css`**

Subito dopo la regola `.hud__size { ... }` e prima di `.hud--avalanche .hud__points { ... }`, aggiungi:

```css
.hud__buffs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.hud__buff {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: rgba(11, 28, 44, 0.35);
  opacity: 0.4;
  transition: opacity 120ms ease, background 120ms ease;
}

.hud__buff--active {
  opacity: 1;
}

.hud__buff--shield.hud__buff--active {
  background: rgba(159, 216, 255, 0.55);
  color: #06202f;
}

.hud__buff--star.hud__buff--active {
  background: rgba(255, 207, 61, 0.65);
  color: #3a2400;
}

.hud__buff--magnet.hud__buff--active {
  background: rgba(230, 72, 60, 0.55);
  color: #fff6f5;
}

.hud__fork {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  padding: 0 12px;
  opacity: 0;
  transform: translateY(-50%) scale(0.9);
  transition: opacity 150ms ease, transform 150ms ease;
}

.hud__fork--visible {
  opacity: 1;
  transform: translateY(-50%) scale(1);
}

.hud__fork-side {
  padding: 6px 14px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.06em;
  background: rgba(11, 28, 44, 0.45);
  opacity: 0.55;
}

.hud__fork-side--rich {
  opacity: 1;
  background: rgba(255, 209, 102, 0.55);
  color: #3a2400;
  box-shadow: 0 0 0 2px rgba(255, 209, 102, 0.8);
}
```

Nel blocco `@media (prefers-reduced-motion: reduce)` esistente, aggiungi `.hud__fork` all'elenco dei selettori che disattivano l'animazione:

```css
@media (prefers-reduced-motion: reduce) {
  .hud--avalanche .hud__points,
  .hud--warning .hud__charge,
  .hud--warning .hud__size,
  .hud__fork {
    animation: none;
    transition: none;
  }

  .hud__charge-fill {
    transition: none;
  }
}
```

- [ ] **Step 14: Verifica finale del task**

Comando: `npm run typecheck && npm run test:run`
Atteso: entrambi PASS.

Verifica visiva (`npm run dev`): da tastiera, freccia sinistra/destra non fanno nulla di visibile fuori da un bivio (corretto: main.ts non instrada ancora `CHOOSE_LEFT/RIGHT` al gioco finché il Task 12 non collega tutto — nessun crash, nessuna azione). I nuovi badge di scudo/stella/calamita restano invisibili (opachi al 40%, senza numero) finché nessuno chiama `setBuffs` con valori attivi: normale, `main.ts` non li chiama ancora prima del Task 12. Nessun elemento nuovo dell'HUD deve intercettare un tap: verificare aprendo gli strumenti di sviluppo e controllando che `.hud`, `.hud__buffs`, `.hud__fork` non abbiano `pointer-events: auto` calcolato.

- [ ] **Step 15: Commit**

```bash
git add src/input/gesture.ts src/input/gesture.test.ts src/input/input.ts src/input/input.test.ts src/ui/hud.ts src/ui/hud.test.ts src/style.css
git commit -m "feat(input,ui): remap swipes to fork choices and add buff/fork HUD indicators"
```

---

### Task 12: Cablaggio finale, bilanciamento e verifica

**Files:**
- Modify: `src/main.ts`
- Modify: `src/audio/audio.ts`
- Modify: `src/audio/audio.test.ts`
- Modify: `src/game/config.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: tutti i moduli riscritti nei Task 1-11 (`game.path`, `game.buffs`, `Action` a quattro voci, `Hud.setBuffs/setFork`, `EntitiesView.sync(entities, path)`, `TerrainView.sync(world, path)`, `PlayerView.sync(..., shielded)`); eventi `fork:appeared`, `fork:resolved`, `buff:gained`, `shield:consumed` da `src/core/events.ts`.
- Produces: `CONFIG.feel.buffShake`, `CONFIG.audio.chime`, `CONFIG.audio.shieldBreak`; `main.ts` completamente ricollegato alla v2; `README.md` aggiornato.

**Cosa fa questo task.** I Task 8-11 hanno lasciato `main.ts` funzionante ma con il cablaggio minimo (le sole chiamate a `sync` necessarie a non rompere la build). Qui si ricollega tutto il resto: le azioni di scelta del ramo, gli indicatori di bivio e buff sull'HUD, i suoni e gli effetti dei nuovi eventi. Poi la passata di bilanciamento sui pochi numeri che il Task 1-7 non fissava già (`CONFIG.collisions.entityBox`, `CONFIG.path`, `CONFIG.avalanche`, `CONFIG.buffs`, `CONFIG.spawn` sono già ai valori del contratto): quelli che restano da tarare sono i numeri introdotti da questi cinque task stessi (feel, audio) e — soprattutto — se, giocando, i due rami di un bivio si leggono comodamente nel campo visivo attuale. Infine la verifica finale end-to-end.

- [ ] **Step 1: Aggiungi i numeri di bilanciamento mancanti a `src/game/config.ts`**

Nel blocco `feel`, subito dopo `smashBurstPower: 6,`, aggiungi:

```ts
    /** Scuotimento leggero alla raccolta di un buff: meno di un impatto, è
     *  un premio, non un colpo. */
    buffShake: 0.4,
```

Nel blocco `audio`, subito dopo la voce `pickup: { ... },`, aggiungi:

```ts
    /** Raccolta di un buff (stella/calamita/scudo): un timbro triangolare
     *  più acuto e più lungo della semplice raccolta, per farlo sentire
     *  come "speciale" senza introdurre un suono radicalmente diverso. */
    chime: { lowHz: 900, highHz: 1400, seconds: 0.22, gain: 0.55 },
    /** Lo scudo che assorbe un colpo: rumore passa-alto, un "crac" cristallino
     *  distinto dal tonfo sordo passa-basso di un impatto normale
     *  (CONFIG.audio.impact). */
    shieldBreak: { cutoffHz: 1600, seconds: 0.35, gain: 0.7 },
```

- [ ] **Step 2: Scrivi i test che falliscono per i nuovi suoni**

In coda al blocco `describe('createAudio', ...)` di `src/audio/audio.test.ts` (subito prima della sua chiusura `});`, aggiungi:

```ts

  it('buff:gained suona un tono acuto (chime), qualunque sia il buff raccolto', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('buff:gained', { kind: 'star' });

    expect(fake.oscillators.length).toBe(1);
    expect(fake.oscillators[0]?.type).toBe('triangle');
    expect(fake.oscillators[0]?.started).toBe(true);
  });

  it('shield:consumed suona un rumore passa-alto, distinto dall impatto normale (passa-basso)', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('shield:consumed', {});

    expect(fake.sources.length).toBe(1);
    expect(fake.sources[0]?.started).toBe(true);
    expect(fake.filters[0]?.type).toBe('highpass');
  });
```

Comando: `npm run test:run -- src/audio/audio.test.ts`
Atteso: FAIL — `bus.emit('buff:gained', ...)` non ha ascoltatori, nessun oscillatore viene creato.

- [ ] **Step 3: Aggiungi i due suoni a `src/audio/audio.ts`**

Subito dopo la funzione `playPickup`, aggiungi:

```ts
  function playChime(): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const { lowHz, highHz, seconds, gain: level } = CONFIG.audio.chime;
    const t = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(lowHz, t);
    osc.frequency.exponentialRampToValueAtTime(highHz, t + seconds);

    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + seconds);
  }

  function playShieldBreak(): void {
    const context = audible();
    if (context === null || master === null || noise === null) {
      return;
    }
    const { cutoffHz, seconds, gain: level } = CONFIG.audio.shieldBreak;
    const t = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = noise;
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(cutoffHz, t);

    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + seconds);
  }
```

E dentro `attach(bus)`, subito dopo la sottoscrizione a `'pickup:collected'`, aggiungi:

```ts
      subscriptions.push(bus.on('buff:gained', () => playChime()));
      subscriptions.push(bus.on('shield:consumed', () => playShieldBreak()));
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run -- src/audio/audio.test.ts`
Atteso: PASS.

- [ ] **Step 5: Ricollega gli eventi e le azioni in `src/main.ts`**

Rimuovi l'import ormai inutile (`entityCenterX` da `./game/lanes`, già non più usato dal Task 9 in avanti se ancora presente) e aggiungi, subito dopo l'import di `worldToViewX` da `./render/camera-rig`:

```ts
import { entityWorldOffsetX } from './render/entities-view';
```

Sostituisci il gestore di `obstacle:hit` (che oggi calcola `hitX` da `payload.lane`/`payload.kind === 'cabin'`) con:

```ts
  bus.on('obstacle:hit', (payload) => {
    const hitX = worldToViewX(entityWorldOffsetX(game.path, { branch: payload.branch }));

    if (payload.outcome === 'smashed' || payload.outcome === 'forgiven') {
      burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, CONFIG.feel.smashBurstPower * particleScale);
      view.shake(CONFIG.feel.impactShake);
      return;
    }
    // morte: l'ostacolo si disintegra subito, la mucca segue al via del rallentatore.
    burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, CONFIG.feel.deathBurstPower * particleScale);
    view.shake(CONFIG.feel.impactShake);
  });
```

Sostituisci i tre usi di `worldToViewX(game.player.x)` (nel gestore di `pickup:collected`, nella scia della valanga e nel gestore di `run:ended`) con `0`: la mucca del giocatore è sempre a x = 0 in v2, quindi non serve più convertire nulla. Ad esempio:

```ts
  bus.on('pickup:collected', (payload) => {
    burstFromModel(pool, MODELS[payload.kind], 0, 0.8, 0, 4 * particleScale);
  });
```

```ts
      avalancheTrail(pool, dt, 0, 0.2, -1.5, intensity);
```

```ts
  bus.on('run:ended', (payload) => {
    record = Math.max(record, payload.points);
    armDeath(flow, payload, CONFIG.feel.deathSlowSeconds);
    view.shake(CONFIG.feel.deathShake);
    burstFromModel(pool, MODELS.cow, 0, 0.6, 0, CONFIG.feel.deathBurstPower * particleScale);
    playerView.group.visible = false;
  });
```

Aggiungi, subito dopo il gestore di `avalanche:triggered`, i quattro nuovi gestori:

```ts
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
```

Nella funzione `syncHud`, aggiungi le due righe che sincronizzano i nuovi indicatori:

```ts
  function syncHud(): void {
    hud.setPoints(game.score.points);
    hud.setCharge(game.avalanche.charge / CONFIG.avalanche.threshold);
    hud.setSize(game.avalanche.size);
    hud.setAvalanche(game.avalanche.phase !== 'idle', game.avalanche.phase === 'warning');
    hud.setBuffs(game.buffs.shield, game.buffs.starTimeLeft, game.buffs.magnetTimeLeft);
  }
```

(`setFork` NON va chiamato qui: è pilotato dagli eventi `fork:appeared`/`fork:resolved`, non da un valore continuo — chiamarlo ogni frame con lo stato corrente del bivio funzionerebbe comunque, ma legarlo agli eventi evita di dover leggere `game.path.phase` da `main.ts`, che altrimenti dovrebbe conoscere i dettagli delle fasi del bivio.)

Nel loop, dove oggi si legge l'azione dal buffer di input:

```ts
      const action = input.consume();
      if (action === 'PAUSE') {
        togglePause();
      } else if (action !== null && machine.current === 'playing' && !isDying(flow)) {
        handleAction(game, action);
      }
```

questo blocco resta INVARIATO: `handleAction(game, action)` accetta già `Action` a quattro voci più `PAUSE` (il tipo è cambiato nel Task 1-7, non qui) — `CHOOSE_LEFT`/`CHOOSE_RIGHT`/`JUMP`/`SLIDE` arrivano già instradati a `game/game.ts` senza bisogno di alcuna modifica in `main.ts`.

- [ ] **Step 6: Aggiorna `README.md`**

Sostituisci la sezione "Come si gioca" con:

```markdown
## Come si gioca

Obiettivo: andare il più lontano possibile, riempire in fretta la barra di
carica e scegliere bene ai bivi.

| Comando | Telefono | Desktop |
|---|---|---|
| Salta | swipe verso l'alto | freccia su, W, barra spaziatrice |
| Scivola / tuffati | swipe verso il basso | freccia giù, S |
| Scegli un ramo (solo ai bivi) | swipe a sinistra / a destra | frecce sinistra/destra, A/D |
| Pausa | bottone in pausa | Esc, P |

- Massi, tronchi caduti, staccionate e crepacci si saltano. Rami di abete,
  archi di roccia e cornicioni di ghiaccio sono sospesi: ci si passa sotto
  scivolando. Un tuffo (swipe giù mentre si è in aria) concatena salto e
  scivolata: è la manovra che salva quando due ostacoli sono vicini.
- Ogni tanto il tracciato si biforca. Il ramo più ricco di fiocchi e buff è
  anche il più ostacolato; l'altro è sgombro. Si legge il bivio prima di
  arrivarci, si sceglie con uno swipe laterale (la scelta si può cambiare
  finché non si supera il punto di non ritorno), e chi non sceglie ottiene
  automaticamente il ramo più sgombro: l'indecisione costa il premio, non la
  corsa.
- I fiocchi in fila caricano la barra (4 punti l'uno) e suggeriscono cosa
  fare: dritti si corre, ad arco si salta, bassi sotto un ostacolo si scivola.
- Quattro buff, sul percorso come i fiocchi: il cristallo di ghiaccio dà
  carica in un colpo, la stella raddoppia i punti per 8 secondi, la calamita
  attira i fiocchi per 8 secondi, il campanaccio dà uno scudo che assorbe un
  impatto (non si accumula: raccoglierne un altro lo ricarica soltanto).
- A barra piena parte la valanga: invulnerabilità e distruzione totale per
  4,5 secondi, punteggio ×5. Nell'ultimo secondo l'interfaccia lampeggia.
- Alla fine della valanga carica e taglia tornano a zero: lo sfogo si paga,
  ma dura poco e torna in fretta.
- Primo impatto perdonato: se la barra è almeno a metà, il primo colpo non
  uccide ma azzera la carica e toglie una taglia.

Il record è salvato in `localStorage`, sul dispositivo.
```

Nella sezione "Struttura", nella riga che descrive `game/`, aggiorna il commento aggiungendo "(percorso a bivi, buff, niente più corsie)":

```markdown
  game/    # regole di gioco: percorso a bivi, buff, niente più corsie — TypeScript puro
```

- [ ] **Step 7: Verifica dei tipi e dei test**

Comando: `npm run typecheck`
Atteso: PASS, zero errori.

Comando: `npm run test:run`
Atteso: PASS, l'intera suite verde (tutti i moduli dei Task 1-12).

- [ ] **Step 8: Verifica del budget grafico**

Comando: `npm run build && npm run preview`, poi apri la pagina servita e osserva la console (che stampa draw call e triangoli ogni `CONFIG.perf.statsLogSeconds`, per `src/main.ts` → `logStats`).
Atteso: `draw call` sotto 60 e `triangoli` sotto 150000 sia fuori da un bivio sia DURANTE un bivio (quando sono visibili più InstancedMesh popolate su entrambi i rami) sia durante una valanga (massimo affollamento di detriti). Se il conteggio dei triangoli è vicino al tetto, il primo sospetto è `MAX_INSTANCES_PER_KIND` (in `src/render/instancing.ts`, NON toccabile in questo blocco di task perché nella lista dei file protetti — se serve davvero abbassarlo, segnalarlo a chi ha scritto quel modulo) o il numero di segmenti della pista dinamica (`TRACK_SEGMENTS` in `terrain.ts`, che qui si può ridurre).

- [ ] **Step 9: Prova su telefono in rete locale**

Comando: `npm run dev -- --host`, poi apri l'URL stampato (quello con l'IP della rete locale, non `localhost`) dal telefono, sulla stessa rete Wi-Fi.

Cosa guardare, nell'ordine in cui capita giocando una run:
1. **Il bivio compare e si legge.** Con qualche secondo di anticipo (CONFIG.path.previewZ = 90 unità, a velocità di crociera è qualche secondo) il tracciato bianco si separa in due nastri; contemporaneamente, al centro dello schermo appare il pannello con "SINISTRA"/"DESTRA", con un lato evidenziato in oro (il ramo ricco). Se il pannello non compare mai, il sospetto è il gestore di `fork:appeared` in `main.ts` o l'evento stesso emesso da `game/path.ts` (Task 1-7).
2. **I due rami hanno contenuti diversi.** Il ramo evidenziato mostra più fiocchi (spesso una fila lunga o ad arco) e, spesso, un buff; l'altro è quasi vuoto. Entrambi sono visibili PRIMA di scegliere.
3. **Il riallineamento è senza scatti.** Dopo lo swipe (o dopo il punto di non ritorno, se non si è scelto), il nastro scelto scivola dolcemente al centro in circa 0,6 secondi (CONFIG.path.realignSeconds): nessun salto istantaneo di camera o di posizione degli ostacoli.
4. **La mucca si appiattisce scivolando.** In scivolata il modello si schiaccia visibilmente e si allarga un poco, continuando a rotolare; se lo scudo è attivo, un alone azzurro semitrasparente la circonda e ruota lentamente.
5. **I fiocchi in fila suggeriscono l'azione.** Una fila dritta corre a terra; una fila ad arco sale e scende sopra un ostacolo; una fila bassa passa sotto un ramo/arco/cornicione.
6. **I buff sono riconoscibili.** Cristallo (schegge cristalline), stella (scintilla dorata a otto punte), calamita (ferro di cavallo rosso), campanaccio (corpo d'ottone troncopiramidale) si distinguono a colpo d'occhio fra loro e dagli ostacoli grigi/marroni.
7. **La valanga scatta spesso e dura poco.** Con la carica a 4 punti per fiocco, la barra si riempie in una manciata di file raccolte; la fase dura solo 4,5 secondi, con l'ultimo secondo lampeggiante, poi torna la calma. Se in pratica la valanga scatta troppo raramente o troppo di frequente rispetto a "un battito regolare", l'unico numero da correggere è `CONFIG.pickups.charge` o `CONFIG.avalanche.threshold` — mai il codice di `avalanche.ts`.
8. **Le prestazioni restano fluide.** Nessun calo percepibile di framerate nel passaggio da un solo nastro a due, né durante una valanga con detriti e scia. Se il monitor perf abbassa la qualità (messaggio in console), è un segnale ma non un fallimento: il degrado automatico è previsto.

Se uno di questi punti non si vede come descritto, annotare quale (con schermata se possibile) prima di considerare il task chiuso: sono gli unici controlli che richiedono un occhio umano e un dispositivo reale.

- [ ] **Step 10: Commit**

```bash
git add src/main.ts src/audio/audio.ts src/audio/audio.test.ts src/game/config.ts README.md
git commit -m "feat: wire forks, buffs and shield to audio/effects, tune v2 balance, update README"
```

---

### Task 13: Scenografia laterale — la montagna torna abitata

Lo spec (§5) stabilisce che baite, alberi e balle di fieno non spariscono dal gioco ma
diventano **scenografia ai lati del tracciato**. I Task 8-12 li lasciano come modelli
disponibili senza istanziarli: questo task li mette in scena. Serve anche a un fine
pratico — con il corridoio ridotto a 4 unità i fianchi risultano spogli, e sono proprio
gli oggetti di riferimento che passano ai lati a dare la sensazione di velocità.

**Files:**
- Create: `src/render/scenery.ts`
- Create: `src/render/scenery.test.ts`
- Modify: `src/game/config.ts` (nuovo blocco `render.scenery`)
- Modify: `src/main.ts` (aggiunta del gruppo alla scena e sincronizzazione)

**Interfaces:**
- Consumes:
  - `MODELS: Record<...>` e `buildGeometry(model, voxelSize): THREE.BufferGeometry` da `src/render/models.ts`
  - `createRng(seed: number): Rng` da `src/core/rng.ts`
  - `WorldState` con `chunks: Chunk[]` (ogni `Chunk` ha `id: number` e `z: number`) da `src/game/world.ts`
  - `CONFIG` da `src/game/config.ts`
- Produces:
  - `interface SceneryItem { kind: 'cabin' | 'tree' | 'hay'; x: number; z: number; yaw: number; scale: number }`
  - `function sceneryForChunk(chunkId: number, out: SceneryItem[]): void`
  - `interface SceneryView { group: THREE.Group; sync(world: WorldState): void }`
  - `function createScenery(): SceneryView`

- [ ] **Step 1: Aggiungi i numeri in configurazione**

In `src/game/config.ts`, dentro il blocco `render`, aggiungi in fondo:

```ts
    /** Oggetti decorativi ai lati del tracciato: non sono entità di gioco, non
     *  collidono mai e non devono MAI entrare nel corridoio giocabile. */
    scenery: {
      itemsPerChunk: 7,
      /** Distanza laterale minima dal centro: deve restare ben oltre il bordo
       *  del corridoio (world.trackWidth / 2) perché non si confonda con un
       *  ostacolo da schivare. */
      minLateral: 9,
      maxLateral: 46,
      /** Peso relativo dei tre modelli decorativi. */
      weights: { tree: 7, cabin: 2, hay: 3 },
      minScale: 0.8,
      maxScale: 1.6,
    },
```

- [ ] **Step 2: Scrivi il test che fallisce**

```ts
// src/render/scenery.test.ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { sceneryForChunk, type SceneryItem } from './scenery';

describe('sceneryForChunk', () => {
  it('genera sempre lo stesso layout per lo stesso chunk', () => {
    const a: SceneryItem[] = [];
    const b: SceneryItem[] = [];
    sceneryForChunk(3, a);
    sceneryForChunk(3, b);
    expect(a).toEqual(b);
    expect(a.length).toBe(CONFIG.render.scenery.itemsPerChunk);
  });

  it('genera layout diversi per chunk diversi', () => {
    const a: SceneryItem[] = [];
    const b: SceneryItem[] = [];
    sceneryForChunk(1, a);
    sceneryForChunk(2, b);
    expect(a).not.toEqual(b);
  });

  it('non mette MAI un oggetto dentro o vicino al corridoio giocabile', () => {
    const corridorHalf = CONFIG.world.trackWidth / 2;
    const items: SceneryItem[] = [];
    for (let chunk = 0; chunk < 500; chunk += 1) {
      items.length = 0;
      sceneryForChunk(chunk, items);
      for (const item of items) {
        expect(Math.abs(item.x)).toBeGreaterThanOrEqual(CONFIG.render.scenery.minLateral);
        expect(Math.abs(item.x)).toBeGreaterThan(corridorHalf);
        expect(Math.abs(item.x)).toBeLessThanOrEqual(CONFIG.render.scenery.maxLateral);
      }
    }
  });

  it('distribuisce gli oggetti su entrambi i lati', () => {
    const items: SceneryItem[] = [];
    let left = 0;
    let right = 0;
    for (let chunk = 0; chunk < 200; chunk += 1) {
      items.length = 0;
      sceneryForChunk(chunk, items);
      for (const item of items) {
        if (item.x < 0) left += 1;
        else right += 1;
      }
    }
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    // nessuno dei due lati deve prendersi più del 70% degli oggetti
    const total = left + right;
    expect(left / total).toBeLessThan(0.7);
    expect(right / total).toBeLessThan(0.7);
  });

  it('tiene z dentro la lunghezza del chunk e la scala nei limiti', () => {
    const items: SceneryItem[] = [];
    sceneryForChunk(11, items);
    for (const item of items) {
      expect(item.z).toBeGreaterThanOrEqual(0);
      expect(item.z).toBeLessThan(CONFIG.world.chunkLength);
      expect(item.scale).toBeGreaterThanOrEqual(CONFIG.render.scenery.minScale);
      expect(item.scale).toBeLessThanOrEqual(CONFIG.render.scenery.maxScale);
    }
  });

  it('riusa l array passato senza allocarne uno nuovo', () => {
    const items: SceneryItem[] = [];
    sceneryForChunk(1, items);
    const first = items;
    sceneryForChunk(2, items);
    expect(items).toBe(first);
    expect(items.length).toBe(CONFIG.render.scenery.itemsPerChunk);
  });
});
```

- [ ] **Step 3: Esegui il test e verifica che fallisca**

Comando: `npx vitest run src/render/scenery.test.ts`
Atteso: FAIL con "Failed to resolve import ./scenery" — il modulo non esiste ancora.

- [ ] **Step 4: Implementa il modulo**

```ts
// src/render/scenery.ts
import * as THREE from 'three';
import { createRng } from '../core/rng';
import { CONFIG } from '../game/config';
import type { WorldState } from '../game/world';
import { MODELS, buildGeometry } from './models';

/** Modelli usati solo come decorazione: non sono entità di gioco. */
export type SceneryKind = 'cabin' | 'tree' | 'hay';

export interface SceneryItem {
  kind: SceneryKind;
  x: number;
  z: number;
  yaw: number;
  scale: number;
}

const KINDS: readonly SceneryKind[] = ['tree', 'cabin', 'hay'];

/**
 * Layout deterministico per un chunk. Il seed deriva dall'id del chunk, quindi
 * un chunk riciclato ricompare sempre identico e la decorazione non "sfarfalla"
 * quando il mondo scorre.
 */
export function sceneryForChunk(chunkId: number, out: SceneryItem[]): void {
  const cfg = CONFIG.render.scenery;
  const rng = createRng(0x5ce7e * 1 + chunkId * 7919);
  out.length = 0;

  const totalWeight = cfg.weights.tree + cfg.weights.cabin + cfg.weights.hay;

  for (let i = 0; i < cfg.itemsPerChunk; i += 1) {
    let roll = rng.next() * totalWeight;
    let kind: SceneryKind = 'tree';
    for (let k = 0; k < KINDS.length; k += 1) {
      const candidate = KINDS[k];
      if (candidate === undefined) continue;
      roll -= cfg.weights[candidate];
      if (roll <= 0) {
        kind = candidate;
        break;
      }
    }

    const side = rng.chance(0.5) ? -1 : 1;
    const lateral = cfg.minLateral + rng.next() * (cfg.maxLateral - cfg.minLateral);

    out.push({
      kind,
      x: side * lateral,
      z: rng.next() * CONFIG.world.chunkLength,
      yaw: rng.next() * Math.PI * 2,
      scale: cfg.minScale + rng.next() * (cfg.maxScale - cfg.minScale),
    });
  }
}

export interface SceneryView {
  group: THREE.Group;
  sync(world: WorldState): void;
}

/**
 * Una InstancedMesh per modello decorativo, dimensionata al caso peggiore
 * (tutti gli oggetti di tutti i chunk dello stesso tipo): tre draw call in
 * totale, indipendenti da quanti oggetti sono a schermo.
 */
export function createScenery(): SceneryView {
  const cfg = CONFIG.render.scenery;
  const capacity = cfg.itemsPerChunk * CONFIG.world.chunkCount;
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  const buffer: SceneryItem[] = [];

  const meshes = new Map<SceneryKind, THREE.InstancedMesh>();
  for (const kind of KINDS) {
    const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    meshes.set(kind, mesh);
    group.add(mesh);
  }

  const counters = new Map<SceneryKind, number>();

  function sync(world: WorldState): void {
    for (const kind of KINDS) counters.set(kind, 0);

    for (let c = 0; c < world.chunks.length; c += 1) {
      const chunk = world.chunks[c];
      if (chunk === undefined) continue;
      sceneryForChunk(chunk.id, buffer);

      for (let i = 0; i < buffer.length; i += 1) {
        const item = buffer[i];
        if (item === undefined) continue;
        const mesh = meshes.get(item.kind);
        const used = counters.get(item.kind) ?? 0;
        if (mesh === undefined || used >= capacity) continue;

        dummy.position.set(item.x, 0, -(chunk.z + item.z));
        dummy.rotation.set(0, item.yaw, 0);
        dummy.scale.setScalar(item.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(used, dummy.matrix);
        counters.set(item.kind, used + 1);
      }
    }

    for (const kind of KINDS) {
      const mesh = meshes.get(kind);
      if (mesh === undefined) continue;
      mesh.count = counters.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return { group, sync };
}
```

- [ ] **Step 5: Esegui i test e verifica che passino**

Comando: `npx vitest run src/render/scenery.test.ts`
Atteso: PASS, 6 test. In particolare deve passare quello sui 500 chunk: se un oggetto
finisce dentro il corridoio, il giocatore vedrà un albero in mezzo alla pista che non
collide, e la fiducia in ciò che si vede è persa.

- [ ] **Step 6: Collega la scenografia alla scena**

In `src/main.ts`, accanto agli altri gruppi di rendering, aggiungi l'import:

```ts
import { createScenery } from './render/scenery';
```

Subito dopo la creazione di `terrain`, crea la vista e aggiungila alla scena:

```ts
  const scenery = createScenery();
  view.scene.add(scenery.group);
```

E in ENTRAMBI i punti in cui viene chiamato `terrain.sync(game.world)` (il ramo di gioco
normale e quello del rallentatore di morte), aggiungi subito sotto:

```ts
      scenery.sync(game.world);
```

- [ ] **Step 7: Verifica completa e visiva**

Comandi: `npm run typecheck`, `npm run test:run`, `npm run build` — tutti verdi.

Poi `npm run dev` e guarda:
- ai lati del tracciato scorrono abeti, baite e balle di fieno, a distanze e dimensioni
  varie, che danno una chiara sensazione di velocità;
- **nessun oggetto decorativo entra mai nel corridoio** né sfiora il punto in cui passa
  la mucca: se ne vedi uno vicino alla pista è un bug, non un caso fortunato;
- la decorazione non sfarfalla e non salta quando i chunk vengono riciclati (ogni chunk
  ricompare identico a sé stesso);
- in console, `renderer.info.render.calls` è cresciuto al massimo di 3.

- [ ] **Step 8: Commit**

```bash
git add src/render/scenery.ts src/render/scenery.test.ts src/game/config.ts src/main.ts
git commit -m "feat(render): populate the slope sides with instanced scenery"
```

---
