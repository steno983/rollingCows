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
