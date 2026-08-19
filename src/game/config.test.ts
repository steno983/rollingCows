import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';

/**
 * Questo file NON deve rispecchiare CONFIG.ts voce per voce: un'asserzione
 * sul valore letterale di un numero di bilanciamento si rompe a ogni
 * taratura legittima del gioco senza aver mai catturato un comportamento
 * (un test che si rompe quando si tara il gioco insegna a ignorare i test).
 * Qui restano solo le verifiche che i residui della v1 (corsie) non sono
 * tornati: quelle sì restano vere qualunque sia la taratura futura.
 */

describe('CONFIG.world', () => {
  it('non ha più le corsie della v1', () => {
    expect('laneCount' in CONFIG.world).toBe(false);
    expect('laneWidth' in CONFIG.world).toBe(false);
  });
});

describe('CONFIG.player', () => {
  it('non ha più i tempi di cambio corsia/atterraggio a terra della v1', () => {
    expect('laneChangeSeconds' in CONFIG.player).toBe(false);
    expect('slamGroundSeconds' in CONFIG.player).toBe(false);
  });
});

describe('CONFIG.spawn', () => {
  it('non ha più i parametri per corsia della v1', () => {
    expect('rowSpacing' in CONFIG.spawn).toBe(false);
    expect('maxBlockedLanes' in CONFIG.spawn).toBe(false);
  });
});
