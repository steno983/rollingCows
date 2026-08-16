import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { clampLane, entityCenterX, entityHalfWidth, laneToX } from './lanes';

describe('laneToX', () => {
  it('mette la corsia centrale esattamente a x = 0', () => {
    expect(laneToX(1)).toBe(0);
  });

  it('mette le corsie esterne simmetriche a +/- laneWidth', () => {
    expect(laneToX(0)).toBe(-CONFIG.world.laneWidth);
    expect(laneToX(2)).toBe(CONFIG.world.laneWidth);
    expect(laneToX(0) + laneToX(2)).toBe(0);
  });
});

describe('entityCenterX', () => {
  it('per una entità larga 1 coincide con il centro della corsia', () => {
    expect(entityCenterX(0, 1)).toBe(laneToX(0));
    expect(entityCenterX(2, 1)).toBe(laneToX(2));
  });

  it('per una cabin larga 2 che parte da lane 0 sta a metà tra le corsie 0 e 1', () => {
    expect(entityCenterX(0, 2)).toBe((laneToX(0) + laneToX(1)) / 2);
  });

  it('per una cabin larga 2 che parte da lane 1 sta a metà tra le corsie 1 e 2', () => {
    expect(entityCenterX(1, 2)).toBe((laneToX(1) + laneToX(2)) / 2);
  });
});

describe('entityHalfWidth', () => {
  it('copre mezza corsia per lato per una entità larga 1', () => {
    expect(entityHalfWidth(1)).toBe(CONFIG.world.laneWidth / 2);
  });

  it('raddoppia per una entità larga 2', () => {
    expect(entityHalfWidth(2)).toBe(entityHalfWidth(1) * 2);
  });
});

describe('clampLane', () => {
  it('lascia invariate le corsie valide', () => {
    expect(clampLane(0)).toBe(0);
    expect(clampLane(1)).toBe(1);
    expect(clampLane(2)).toBe(2);
  });

  it('clampa i valori fuori range agli estremi', () => {
    expect(clampLane(-1)).toBe(0);
    expect(clampLane(-99)).toBe(0);
    expect(clampLane(3)).toBe(2);
    expect(clampLane(99)).toBe(2);
  });

  it('arrotonda i valori non interi alla corsia più vicina', () => {
    expect(clampLane(1.4)).toBe(1);
    expect(clampLane(1.6)).toBe(2);
  });
});
