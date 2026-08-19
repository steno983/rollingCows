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
