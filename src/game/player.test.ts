import { describe, expect, it } from 'vitest';
import { createEventBus, type EventBus, type EventName } from '../core/events';
import { CONFIG } from './config';
import type { PlayerState } from './player';
import { createPlayer, jump, slide, updatePlayer } from './player';

const STEP = 1 / 60;
const { jumpSeconds, jumpHeight, slideSeconds } = CONFIG.player;
const { bufferSeconds } = CONFIG.input;

/** Bus che registra i soli nomi degli eventi del giocatore, nell'ordine: è
 *  l'ordine, più della singola emissione, a dire se salto e scivolata sono
 *  raccontati in modo coerente a chi ci attacca un suono in loop. */
function recordingBus(): { bus: EventBus; names: EventName[]; landings: number[] } {
  const bus = createEventBus();
  const names: EventName[] = [];
  const landings: number[] = [];
  const watched: EventName[] = [
    'player:jumped',
    'player:landed',
    'player:slid',
    'player:slideEnded',
  ];
  for (const name of watched) bus.on(name, () => names.push(name));
  bus.on('player:landed', (payload) => landings.push(payload.airborneSeconds));
  return { bus, names, landings };
}

const silentBus = (): EventBus => createEventBus();

/** Avanza di `seconds` a passi da un frame, fermandosi in ogni caso al limite. */
function advance(player: PlayerState, bus: EventBus, seconds: number): void {
  let elapsed = 0;
  while (elapsed < seconds - 1e-12) {
    const dt = Math.min(STEP, seconds - elapsed);
    updatePlayer(player, dt, bus);
    elapsed += dt;
  }
}

/** Simula il volo e restituisce il tempo di atterraggio e la quota massima.
 *  Si ferma al PRIMO atterraggio: con il buffer d'azione un salto può
 *  incatenarsi al successivo, e `while (player.airborne)` non lo vedrebbe mai
 *  toccare terra. */
function flight(
  player: PlayerState,
  bus: EventBus = silentBus(),
): { landedAt: number; maxY: number; maxAt: number } {
  let elapsed = 0;
  let maxY = 0;
  let maxAt = 0;
  while (elapsed < 5) {
    const wasAirborne = player.airborne;
    updatePlayer(player, STEP, bus);
    elapsed += STEP;
    if (player.y > maxY) {
      maxY = player.y;
      maxAt = elapsed;
    }
    if (wasAirborne && player.y === 0) break;
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

  it('parte senza azioni in coda: un buffer non sopravvive a un inizio corsa', () => {
    // game.ts ricostruisce il giocatore a ogni startRun, quindi questo È
    // l'azzeramento di inizio corsa. Senza, un tasto premuto durante la
    // schermata di morte farebbe partire la corsa successiva con la mucca già
    // per aria.
    const player = createPlayer();
    expect(player.bufferedJump).toBe(0);
    expect(player.bufferedSlide).toBe(0);
  });
});

describe('jump', () => {
  it('descrive una parabola che culmina vicino a jumpHeight a metà volo', () => {
    const player = createPlayer();
    jump(player, silentBus());
    expect(player.airborne).toBe(true);

    const { maxY, maxAt } = flight(player);
    expect(maxY).toBeGreaterThan(jumpHeight - 0.05);
    expect(maxY).toBeLessThanOrEqual(jumpHeight + 1e-6);
    expect(Math.abs(maxAt - jumpSeconds / 2)).toBeLessThan(0.05);
  });

  it('atterra dopo jumpSeconds', () => {
    const player = createPlayer();
    jump(player, silentBus());
    const { landedAt } = flight(player);

    expect(Math.abs(landedAt - jumpSeconds)).toBeLessThanOrEqual(STEP);
    expect(player.y).toBe(0);
    expect(player.vy).toBe(0);
    expect(player.airborne).toBe(false);
  });

  it('non altera il salto in corso se lo si richiede a mezz-aria', () => {
    const player = createPlayer();
    jump(player, silentBus());
    for (let i = 0; i < 10; i++) updatePlayer(player, STEP, silentBus());
    const yBefore = player.y;
    const vyBefore = player.vy;

    jump(player, silentBus());
    expect(player.y).toBe(yBefore);
    expect(player.vy).toBe(vyBefore);
    // ...ma non è più buttata via: resta armata (vedi il buffer d'azione).
    expect(player.bufferedJump).toBeCloseTo(bufferSeconds, 10);
  });
});

describe('buffer d-azione', () => {
  it('un salto chiesto in aria a MENO di bufferSeconds dall-atterraggio parte all-atterraggio', () => {
    const player = createPlayer();
    const { bus, names } = recordingBus();
    jump(player, bus);
    // Si arriva a un soffio dall'atterraggio: il residuo di volo è più corto
    // della finestra del buffer.
    const remaining = bufferSeconds / 2;
    advance(player, bus, jumpSeconds - remaining);
    expect(player.airborne).toBe(true);

    jump(player, bus);
    advance(player, bus, remaining + STEP);

    // Il secondo salto è partito da solo: la mucca è di nuovo per aria.
    expect(player.airborne).toBe(true);
    expect(player.bufferedJump).toBe(0);
    expect(names).toEqual(['player:jumped', 'player:landed', 'player:jumped']);
  });

  it('un salto chiesto PRIMA di quella finestra non parte', () => {
    const player = createPlayer();
    const { bus, names } = recordingBus();
    jump(player, bus);
    // Richiesta data molto presto: il buffer scade prima di toccare terra.
    advance(player, bus, STEP);
    jump(player, bus);
    expect(player.bufferedJump).toBeGreaterThan(0);

    advance(player, bus, jumpSeconds);

    expect(player.airborne).toBe(false);
    expect(player.bufferedJump).toBe(0);
    expect(names).toEqual(['player:jumped', 'player:landed']);
  });

  it('il buffer decade esattamente di dt e non sopravvive a bufferSeconds', () => {
    const player = createPlayer();
    const bus = silentBus();
    jump(player, bus);
    jump(player, bus);
    expect(player.bufferedJump).toBeCloseTo(bufferSeconds, 10);

    updatePlayer(player, bufferSeconds / 2, bus);
    expect(player.bufferedJump).toBeCloseTo(bufferSeconds / 2, 10);

    updatePlayer(player, bufferSeconds, bus);
    expect(player.bufferedJump).toBe(0);
  });

  it('una scivolata chiesta mentre una è in corso parte alla fine di quella in corso', () => {
    const player = createPlayer();
    const { bus, names } = recordingBus();
    slide(player, bus);
    advance(player, bus, slideSeconds - bufferSeconds / 2);
    expect(player.sliding).toBe(true);

    slide(player, bus);
    // Non ri-arma la scivolata in corso (tenere premuto non vale scivolata
    // infinita): resta in coda.
    expect(player.slideTimer).toBeLessThan(slideSeconds);
    expect(player.bufferedSlide).toBeCloseTo(bufferSeconds, 10);

    advance(player, bus, bufferSeconds);

    expect(player.sliding).toBe(true);
    expect(player.slideTimer).toBeGreaterThan(0);
    expect(player.bufferedSlide).toBe(0);
    // La fine della prima resta annunciata: 'player:slid' e
    // 'player:slideEnded' si alternano sempre.
    expect(names).toEqual(['player:slid', 'player:slideEnded', 'player:slid']);
  });

  it('una scivolata chiesta troppo presto non riparte da sola', () => {
    const player = createPlayer();
    const { bus, names } = recordingBus();
    slide(player, bus);
    advance(player, bus, STEP);
    slide(player, bus);

    advance(player, bus, slideSeconds);

    expect(player.sliding).toBe(false);
    expect(names).toEqual(['player:slid', 'player:slideEnded']);
  });
});

describe('eventi del giocatore', () => {
  it('annuncia salto e atterraggio, con i secondi passati per aria', () => {
    const player = createPlayer();
    const { bus, names, landings } = recordingBus();
    jump(player, bus);
    flight(player, bus);

    expect(names).toEqual(['player:jumped', 'player:landed']);
    const airborneSeconds = landings[0];
    if (airborneSeconds === undefined) throw new Error('nessun atterraggio registrato');
    expect(Math.abs(airborneSeconds - jumpSeconds)).toBeLessThanOrEqual(STEP);
  });

  it('un salto che interrompe una scivolata ne annuncia comunque la fine', () => {
    const player = createPlayer();
    const { bus, names } = recordingBus();
    slide(player, bus);
    advance(player, bus, STEP);
    jump(player, bus);

    expect(names).toEqual(['player:slid', 'player:slideEnded', 'player:jumped']);
  });
});

describe('slide a terra', () => {
  it('dura slideSeconds e poi si spegne', () => {
    const player = createPlayer();
    const bus = silentBus();
    slide(player, bus);
    expect(player.sliding).toBe(true);
    expect(player.slideTimer).toBeCloseTo(slideSeconds, 10);

    updatePlayer(player, slideSeconds / 2, bus);
    expect(player.sliding).toBe(true);

    updatePlayer(player, slideSeconds / 2 + STEP, bus);
    expect(player.sliding).toBe(false);
    expect(player.slideTimer).toBe(0);
  });

  it('può essere ri-avviata a fine durata', () => {
    const player = createPlayer();
    const bus = silentBus();
    slide(player, bus);
    updatePlayer(player, slideSeconds + STEP, bus);
    expect(player.sliding).toBe(false);

    slide(player, bus);
    expect(player.sliding).toBe(true);
    expect(player.slideTimer).toBeCloseTo(slideSeconds, 10);
  });
});

describe('slide in aria (tuffo)', () => {
  it('accelera la caduta rispetto a un salto normale', () => {
    const plain = createPlayer();
    jump(plain, silentBus());
    const plainFlight = flight(plain);

    const diving = createPlayer();
    jump(diving, silentBus());
    updatePlayer(diving, STEP, silentBus());
    slide(diving, silentBus());
    expect(diving.sliding).toBe(true);
    const diveFlight = flight(diving);

    expect(diveFlight.landedAt + STEP).toBeLessThan(plainFlight.landedAt);
  });

  it('all-atterraggio il giocatore risulta in scivolata', () => {
    const player = createPlayer();
    const { bus, names } = recordingBus();
    jump(player, bus);
    updatePlayer(player, STEP, bus);
    slide(player, bus);

    flight(player, bus);

    expect(player.airborne).toBe(false);
    expect(player.y).toBe(0);
    expect(player.sliding).toBe(true);
    expect(player.slideTimer).toBeCloseTo(slideSeconds, 10);
    // Il tuffo NON annuncia una scivolata mentre è in aria: la scivolata vera
    // nasce all'atterraggio, e annunciarla due volte romperebbe l'alternanza.
    expect(names).toEqual(['player:jumped', 'player:landed', 'player:slid']);
  });

  it('un salto bufferizzato durante il tuffo vince sulla scivolata di atterraggio', () => {
    // La pressione di salto è più recente della scivolata che il tuffo mette
    // in coda da solo: onorarla è la stessa scelta che vale a terra, dove un
    // salto interrompe sempre una scivolata.
    const player = createPlayer();
    const bus = silentBus();
    jump(player, bus);
    updatePlayer(player, STEP, bus);
    slide(player, bus);
    // Il tuffo accorcia il volo: si aspetta di essere dentro la finestra del
    // buffer avanzando fin quasi a terra.
    while (player.airborne && player.y > 0.2) updatePlayer(player, STEP, bus);
    jump(player, bus);
    updatePlayer(player, STEP, bus);
    updatePlayer(player, STEP, bus);

    expect(player.airborne).toBe(true);
    expect(player.sliding).toBe(false);
    expect(player.slideTimer).toBe(0);
  });
});

describe('salto durante la scivolata', () => {
  it('è possibile e interrompe la scivolata', () => {
    // Scelta di design (vedi commento del task): come già in v1 per lo slam a
    // terra, saltare durante una scivolata la interrompe subito invece di
    // restare bloccati a terra finché non scade slideTimer.
    const player = createPlayer();
    const bus = silentBus();
    slide(player, bus);
    expect(player.sliding).toBe(true);

    jump(player, bus);

    expect(player.airborne).toBe(true);
    expect(player.sliding).toBe(false);
    expect(player.slideTimer).toBe(0);
  });

  it('scarta anche la scivolata che era in coda', () => {
    // Quella richiesta era "prolunga QUESTA scivolata", non "scivola
    // all'atterraggio": tenerla armata farebbe scivolare la mucca appena
    // ritocca terra, senza che nessuno l'abbia chiesto.
    const player = createPlayer();
    const bus = silentBus();
    slide(player, bus);
    advance(player, bus, STEP);
    slide(player, bus);
    expect(player.bufferedSlide).toBeGreaterThan(0);

    jump(player, bus);
    expect(player.bufferedSlide).toBe(0);
  });
});
