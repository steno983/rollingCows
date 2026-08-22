import { describe, expect, it } from 'vitest';
import type { Box } from './collisions';
import { boxesOverlap, ENTITY_BOX, entityBox, playerBox } from './collisions';
import { CONFIG } from './config';
import { createPlayer, jump, updatePlayer } from './player';
import { resolveDifficultyProfile, speedAt } from './speed';
import type { Entity, EntityKind } from './types';
import { isOverhead } from './types';

const GROUND_KINDS: readonly EntityKind[] = ['rock', 'log', 'fence', 'crevasse', 'chasm'];
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
  // ATTENZIONE: playerBox restituisce sempre lo STESSO oggetto, riempito in
  // place (zero allocazioni nel loop di collisione). Due chiamate non danno
  // due box da confrontare fra loro: qui si leggono subito i numeri.
  it('cresce in altezza con la taglia', () => {
    const smallHeight = playerBox(0, 1, false).height;
    const smallDepth = playerBox(0, 1, false).depth;
    const bigHeight = playerBox(0, 5, false).height;
    expect(bigHeight).toBeGreaterThan(smallHeight);
    expect(smallHeight).toBeCloseTo(CONFIG.player.baseHeight + CONFIG.player.heightPerSize, 10);
    expect(smallDepth).toBe(CONFIG.player.depth);
  });

  it('in scivolata riduce l-altezza esattamente di slideHeightRatio', () => {
    for (const size of ALL_SIZES) {
      const uprightHeight = playerBox(0, size, false).height;
      const slidingHeight = playerBox(0, size, true).height;
      expect(slidingHeight).toBeCloseTo(uprightHeight * CONFIG.player.slideHeightRatio, 10);
    }
  });
});

describe('zero allocazioni nel loop caldo', () => {
  it('playerBox ed entityBox riempiono due scratch distinti, senza allocare', () => {
    // La regola di progetto «nel loop non si alloca» vale anche per una manciata
    // di oggetti letterali per frame. I due scratch sono distinti perché il
    // ciclo di collisione di game.ts tiene il box del giocatore mentre scorre
    // quelli delle entità: un solo scratch condiviso li farebbe collassare.
    const first = playerBox(0, 1, false);
    const second = playerBox(2, 5, true);
    expect(second).toBe(first);

    const rock = entityBox(makeEntity('rock', 10));
    const log = entityBox(makeEntity('log', 20));
    expect(log).toBe(rock);
    expect(rock).not.toBe(first);
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

  it('IN PIEDI, a qualunque taglia da 1 a 5, si colpisce OGNI ostacolo sospeso', () => {
    // L'altra metà dell'invariante di design §6: se la mucca piccola passasse
    // sotto ai sospesi restando in piedi, l'azione richiesta cambierebbe con
    // la taglia e un terzo degli ostacoli non chiederebbe nulla al giocatore.
    for (const kind of OVERHEAD_KINDS) {
      const overhead = entityBox(makeEntity(kind, 0, CONFIG.spawn.overheadY));
      for (const size of ALL_SIZES) {
        const upright = playerBox(0, size, false);
        expect(
          boxesOverlap(upright, overhead),
          `taglia ${size} dovrebbe colpire ${kind} restando in piedi`,
        ).toBe(true);
      }
    }
  });

  it('il margine peggiore in piedi (taglia minima) resta strettamente positivo', () => {
    const smallestUprightTop = playerBox(0, 1, false).height;
    expect(smallestUprightTop).toBeGreaterThan(CONFIG.spawn.overheadY);
  });
});

describe('CREPACCIO: la superabilità è una proprietà da verificare, non da dichiarare', () => {
  const STEP = 1 / 60;

  /**
   * Simula un salto contro un crepaccio che arriva a velocità `speed`, con il
   * salto avviato dopo `jumpDelay` secondi, e dice se la mucca è passata.
   *
   * Usa le funzioni vere — la parabola di player.ts e il test AABB di
   * collisions.ts — invece della formula chiusa scritta in config: la formula
   * è il RAGIONAMENTO, questo è il controllo che il gioco si comporti come il
   * ragionamento dice. Fuori dal gioco completo perché qui interessa una cosa
   * sola: se il crepaccio, da solo, si salta.
   */
  function clears(speed: number, jumpDelay: number): boolean {
    const bus = { on: () => () => {}, emit: () => {}, clear: () => {} };
    const player = createPlayer();
    const chasm = makeEntity('chasm', (CONFIG.player.depth + ENTITY_BOX.chasm.depth) / 2 + speed);
    let elapsed = 0;
    let jumped = false;
    while (chasm.z > -(CONFIG.player.depth + ENTITY_BOX.chasm.depth)) {
      if (!jumped && elapsed >= jumpDelay) {
        jump(player, bus);
        jumped = true;
      }
      updatePlayer(player, STEP, bus);
      chasm.z -= speed * STEP;
      elapsed += STEP;
      if (boxesOverlap(playerBox(player.y, 1, player.sliding), entityBox(chasm))) return false;
    }
    return jumped;
  }

  /** Le velocità a cui un crepaccio può davvero nascere: dalla più lenta
   *  possibile (il tetto di "Vitellino", che a spawn.lateRampStart è già
   *  raggiunto) alla più alta del gioco. */
  const SPEEDS = (['calf', 'normal', 'bull'] as const).flatMap((name) => {
    const profile = resolveDifficultyProfile(name);
    return [
      { name: `${name} @ lateRampStart`, speed: speedAt(CONFIG.spawn.lateRampStart, profile) },
      { name: `${name} @ tetto`, speed: profile.maxSpeed },
    ];
  });

  it('a nessuna di quelle velocità il crepaccio è impossibile', () => {
    for (const { name, speed } of SPEEDS) {
      const windows: number[] = [];
      for (let step = 0; step * STEP < 2; step++) {
        if (clears(speed, step * STEP)) windows.push(step);
      }
      // 0,2 s è il margine di errore che il gioco concede altrove sulla
      // spaziatura (vedi spawn.minObstacleGap): sotto quella soglia si
      // smetterebbe di reagire e si comincerebbe a memorizzare.
      const seconds = windows.length * STEP;
      expect(`${name}: ${seconds.toFixed(3)} s`).toBe(
        seconds >= 0.2 ? `${name}: ${seconds.toFixed(3)} s` : `${name}: >= 0.200 s`,
      );
      // Contigua: se i salti che salvano non fossero consecutivi il margine
      // sarebbe un artefatto del passo di simulazione, non una finestra.
      const first = windows[0];
      const last = windows[windows.length - 1];
      if (first === undefined || last === undefined) throw new Error('nessun salto riuscito');
      expect(last - first + 1).toBe(windows.length);
    }
  });

  it('resta più largo di una crepa: sono due ostacoli diversi, non due nomi', () => {
    expect(ENTITY_BOX.chasm.depth).toBeGreaterThan(ENTITY_BOX.crevasse.depth * 1.5);
  });
});

describe('CARTELLO: non è scavalcabile per costruzione', () => {
  it('è più alto dell-apice del salto, quindi non esiste una quota a cui passare', () => {
    // `jumpHeight` è l-apice della BASE della sagoma: più in alto la base non
    // arriva mai, a nessuna velocità e con nessuna gravità (il tuffo abbassa
    // l-apice, non lo alza). Se questa disuguaglianza cadesse, "scegli o
    // muori" diventerebbe "scegli o salta".
    expect(ENTITY_BOX.signpost.height).toBeGreaterThan(CONFIG.player.jumpHeight);
  });

  it('le due sagome si sovrappongono a OGNI quota raggiungibile e a ogni taglia', () => {
    const sign = makeEntity('signpost', 0);
    for (const size of ALL_SIZES) {
      for (let y = 0; y <= CONFIG.player.jumpHeight; y += 0.05) {
        for (const sliding of [false, true]) {
          expect(boxesOverlap(playerBox(y, size, sliding), entityBox(sign))).toBe(true);
        }
      }
    }
  });
});
