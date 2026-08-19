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
