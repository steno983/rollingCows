import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { ENTITY_BOX, boxesOverlap, entityBox, playerBox } from './collisions';
import { laneToX } from './lanes';
import type { Box } from './collisions';
import type { Entity, EntityKind, Lane } from './types';

function makeEntity(kind: EntityKind, lane: Lane, z = 0, y = 0, width: 1 | 2 = 1): Entity {
  const pickups = new Set<EntityKind>(['snowflake', 'hay', 'cow']);
  return {
    id: 1,
    kind,
    category: pickups.has(kind) ? 'pickup' : 'obstacle',
    lane,
    width,
    z,
    y,
    alive: true,
  };
}

function box(x: number, halfWidth: number, y: number, height: number, z: number, depth: number): Box {
  return { x, halfWidth, y, height, z, depth };
}

describe('boxesOverlap', () => {
  it('rileva la sovrapposizione di due box coincidenti', () => {
    const a = box(0, 1, 0, 2, 0, 2);
    expect(boxesOverlap(a, box(0, 1, 0, 2, 0, 2))).toBe(true);
  });

  it('separa correttamente sull-asse X', () => {
    const a = box(0, 1, 0, 2, 0, 2);
    expect(boxesOverlap(a, box(1.5, 1, 0, 2, 0, 2))).toBe(true);
    expect(boxesOverlap(a, box(3, 1, 0, 2, 0, 2))).toBe(false);
  });

  it('separa correttamente sull-asse Y', () => {
    const a = box(0, 1, 0, 2, 0, 2);
    expect(boxesOverlap(a, box(0, 1, 1.5, 2, 0, 2))).toBe(true);
    expect(boxesOverlap(a, box(0, 1, 2.5, 2, 0, 2))).toBe(false);
  });

  it('separa correttamente sull-asse Z', () => {
    const a = box(0, 1, 0, 2, 0, 2);
    expect(boxesOverlap(a, box(0, 1, 0, 2, 1.5, 2))).toBe(true);
    expect(boxesOverlap(a, box(0, 1, 0, 2, 3, 2))).toBe(false);
  });

  it('non considera collisione il contatto esatto sui bordi', () => {
    const a = box(0, 1, 0, 2, 0, 2);
    expect(boxesOverlap(a, box(2, 1, 0, 2, 0, 2))).toBe(false);
    expect(boxesOverlap(a, box(0, 1, 2, 2, 0, 2))).toBe(false);
    expect(boxesOverlap(a, box(0, 1, 0, 2, 2, 2))).toBe(false);
  });
});

describe('playerBox', () => {
  it('si allarga e si alza al crescere della taglia', () => {
    const small = playerBox(0, 0, 1);
    const big = playerBox(0, 0, 5);
    expect(big.halfWidth).toBeGreaterThan(small.halfWidth);
    expect(big.height).toBeGreaterThan(small.height);
    expect(small.halfWidth).toBeCloseTo(
      CONFIG.player.baseHalfWidth + CONFIG.player.halfWidthPerSize,
      10,
    );
    expect(small.depth).toBe(CONFIG.player.depth);
  });

  it('abbassa la mucca in schiacciata senza toccarne la larghezza', () => {
    const upright = playerBox(0, 0, 3);
    const slammed = playerBox(0, 0, 3, true);
    expect(slammed.height).toBeLessThan(upright.height);
    expect(slammed.halfWidth).toBe(upright.halfWidth);
  });
});

describe('entityBox', () => {
  it('usa le misure per kind di ENTITY_BOX', () => {
    const rock = entityBox(makeEntity('rock', 1));
    expect(rock.height).toBe(ENTITY_BOX.rock.height);
    expect(rock.depth).toBe(ENTITY_BOX.rock.depth);
    expect(rock.x).toBe(laneToX(1));
  });

  it('centra la cabin larga 2 tra le due corsie occupate', () => {
    const cabin = entityBox(makeEntity('cabin', 0, 0, 0, 2));
    expect(cabin.x).toBe((laneToX(0) + laneToX(1)) / 2);
    expect(cabin.halfWidth).toBe(CONFIG.world.laneWidth);
  });
});

describe('collisioni di gioco', () => {
  it('un giocatore in corsia 0 non collide con un ostacolo in corsia 2', () => {
    const player = playerBox(laneToX(0), 0, 5);
    expect(boxesOverlap(player, entityBox(makeEntity('rock', 2)))).toBe(false);
    expect(boxesOverlap(player, entityBox(makeEntity('rock', 0)))).toBe(true);
  });

  it('saltando si passa sopra una fence ma non sopra una cabin', () => {
    const apex = CONFIG.player.jumpHeight;
    const player = playerBox(laneToX(1), apex, 1);
    expect(boxesOverlap(player, entityBox(makeEntity('fence', 1)))).toBe(false);
    expect(boxesOverlap(player, entityBox(makeEntity('cabin', 0, 0, 0, 2)))).toBe(true);
  });

  it('il branch colpisce la mucca cresciuta, ma non se è in schiacciata', () => {
    const branch = entityBox(makeEntity('branch', 1, 0, 1.6));
    expect(boxesOverlap(playerBox(laneToX(1), 0, 3), branch)).toBe(true);
    expect(boxesOverlap(playerBox(laneToX(1), 0, 3, true), branch)).toBe(false);
  });

  it('la mucca a taglia 1 passa sotto al branch anche senza schiacciata', () => {
    // Conseguenza voluta delle costanti: a taglia 1 la mucca è alta 1.45 < 1.6.
    const branch = entityBox(makeEntity('branch', 1, 0, 1.6));
    expect(boxesOverlap(playerBox(laneToX(1), 0, 1), branch)).toBe(false);
  });

  it('il crevasse colpisce solo chi è a terra', () => {
    const crevasse = entityBox(makeEntity('crevasse', 1));
    expect(boxesOverlap(playerBox(laneToX(1), 0, 1), crevasse)).toBe(true);
    expect(boxesOverlap(playerBox(laneToX(1), 1, 1), crevasse)).toBe(false);
    expect(boxesOverlap(playerBox(laneToX(1), CONFIG.player.jumpHeight, 1), crevasse)).toBe(false);
  });

  it('definisce una misura per ogni kind', () => {
    const kinds: EntityKind[] = [
      'rock',
      'tree',
      'fence',
      'cabin',
      'crevasse',
      'branch',
      'snowflake',
      'hay',
      'cow',
    ];
    for (const kind of kinds) {
      expect(ENTITY_BOX[kind].height).toBeGreaterThan(0);
      expect(ENTITY_BOX[kind].depth).toBeGreaterThan(0);
    }
  });
});
