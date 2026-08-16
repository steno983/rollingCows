import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { laneToX } from './lanes';
import { SLAM_GROUND_SECONDS, createPlayer, jump, moveLane, slam, updatePlayer } from './player';
import type { PlayerState } from './player';

const STEP = 1 / 60;
const { laneChangeSeconds, jumpSeconds, jumpHeight } = CONFIG.player;

/** Simula il volo e restituisce il tempo di atterraggio e la quota massima. */
function flight(player: PlayerState, onStep?: (elapsed: number) => void): {
  landedAt: number;
  maxY: number;
  maxAt: number;
} {
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
    onStep?.(elapsed);
  }
  return { landedAt: elapsed, maxY, maxAt };
}

describe('createPlayer', () => {
  it('parte in corsia 1, a x = 0, a terra', () => {
    const player = createPlayer();
    expect(player.lane).toBe(1);
    expect(player.x).toBe(0);
    expect(player.x).toBe(laneToX(1));
    expect(player.y).toBe(0);
    expect(player.airborne).toBe(false);
    expect(player.slamming).toBe(false);
  });
});

describe('moveLane', () => {
  it('porta a corsia 0 e completa la transizione entro laneChangeSeconds', () => {
    const player = createPlayer();
    moveLane(player, -1);
    expect(player.lane).toBe(0);

    let elapsed = 0;
    while (elapsed < laneChangeSeconds) {
      updatePlayer(player, STEP);
      elapsed += STEP;
    }
    expect(player.x).toBeCloseTo(laneToX(0), 10);
    expect(player.laneChangeT).toBe(1);
  });

  it('non fa nulla oltre i bordi', () => {
    const player = createPlayer();
    moveLane(player, -1);
    for (let i = 0; i < 20; i++) updatePlayer(player, STEP);
    expect(player.lane).toBe(0);

    moveLane(player, -1);
    expect(player.lane).toBe(0);
    expect(player.x).toBeCloseTo(laneToX(0), 10);

    moveLane(player, 1);
    moveLane(player, 1);
    for (let i = 0; i < 40; i++) updatePlayer(player, STEP);
    expect(player.lane).toBe(2);
    moveLane(player, 1);
    expect(player.lane).toBe(2);
  });

  it('interpola in ease-out: a metà tempo ha percorso più di metà distanza', () => {
    const player = createPlayer();
    moveLane(player, -1);
    updatePlayer(player, laneChangeSeconds / 2);

    const travelled = Math.abs(player.x - 0);
    const total = Math.abs(laneToX(0) - 0);
    expect(player.laneChangeT).toBeCloseTo(0.5, 10);
    expect(travelled / total).toBeGreaterThan(0.5);
    expect(travelled / total).toBeLessThan(1);
  });

  it('riparte dalla x corrente se si cambia corsia durante una transizione', () => {
    const player = createPlayer();
    moveLane(player, -1);
    updatePlayer(player, laneChangeSeconds / 2);
    const xBefore = player.x;

    moveLane(player, 1);
    expect(player.lane).toBe(1);
    expect(player.laneFromX).toBeCloseTo(xBefore, 10);
    expect(player.laneChangeT).toBe(0);

    updatePlayer(player, 0.001);
    expect(Math.abs(player.x - xBefore)).toBeLessThan(0.15);
  });
});

describe('jump', () => {
  it('mette in aria e descrive una parabola che culmina vicino a jumpHeight', () => {
    const player = createPlayer();
    jump(player);
    expect(player.airborne).toBe(true);

    const { maxY, maxAt } = flight(player);
    expect(maxY).toBeGreaterThan(jumpHeight - 0.05);
    expect(maxY).toBeLessThanOrEqual(jumpHeight + 1e-6);
    expect(Math.abs(maxAt - jumpSeconds / 2)).toBeLessThan(0.05);
  });

  it('atterra a fine jumpSeconds riportando y a 0', () => {
    const player = createPlayer();
    jump(player);
    const { landedAt } = flight(player);

    expect(Math.abs(landedAt - jumpSeconds)).toBeLessThanOrEqual(STEP);
    expect(player.y).toBe(0);
    expect(player.vy).toBe(0);
    expect(player.airborne).toBe(false);
  });

  it('sale prima di scendere', () => {
    const player = createPlayer();
    jump(player);
    updatePlayer(player, STEP);
    const first = player.y;
    updatePlayer(player, STEP);
    expect(player.y).toBeGreaterThan(first);
    expect(first).toBeGreaterThan(0);
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

describe('slam', () => {
  it('a terra tiene la mucca abbassata per SLAM_GROUND_SECONDS e poi si spegne', () => {
    const player = createPlayer();
    slam(player);
    expect(player.slamming).toBe(true);
    expect(player.slamTimer).toBeCloseTo(SLAM_GROUND_SECONDS, 10);
    expect(SLAM_GROUND_SECONDS).toBe(0.25);

    updatePlayer(player, 0.1);
    expect(player.slamming).toBe(true);

    updatePlayer(player, 0.2);
    expect(player.slamming).toBe(false);
    expect(player.slamTimer).toBe(0);
  });

  it('in aria accelera la caduta', () => {
    const plain = createPlayer();
    jump(plain);
    const plainFlight = flight(plain);

    const slammed = createPlayer();
    jump(slammed);
    updatePlayer(slammed, STEP);
    slam(slammed);
    expect(slammed.slamming).toBe(true);
    const slamFlight = flight(slammed);

    expect(slamFlight.landedAt + STEP).toBeLessThan(plainFlight.landedAt);
    expect(slammed.airborne).toBe(false);
    expect(slammed.y).toBe(0);
    expect(slammed.slamming).toBe(false);
  });

  it('non lascia lo slam attivo dopo l-atterraggio', () => {
    const player = createPlayer();
    jump(player);
    slam(player);
    flight(player);
    expect(player.slamming).toBe(false);
    expect(player.slamTimer).toBe(0);
  });

  it('saltare durante uno slam a terra annulla lo slam', () => {
    const player = createPlayer();
    slam(player);
    jump(player);
    expect(player.slamming).toBe(false);
    expect(player.slamTimer).toBe(0);
    expect(player.airborne).toBe(true);
  });
});
