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
