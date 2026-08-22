import { describe, expect, it } from 'vitest';
import type { EntityKind } from './types';
import { isOverhead } from './types';

const GROUND_KINDS: readonly EntityKind[] = ['rock', 'log', 'fence', 'crevasse'];
const OVERHEAD_KINDS: readonly EntityKind[] = ['branch', 'arch', 'cornice'];
const PICKUP_KINDS: readonly EntityKind[] = ['snowflake', 'crystal', 'star', 'magnet', 'bell'];

describe('isOverhead', () => {
  it('è vero per ogni ostacolo sospeso', () => {
    for (const kind of OVERHEAD_KINDS) {
      expect(isOverhead(kind)).toBe(true);
    }
  });

  it('è falso per ogni ostacolo a terra', () => {
    for (const kind of GROUND_KINDS) {
      expect(isOverhead(kind)).toBe(false);
    }
  });

  it('è falso per ogni raccoglibile', () => {
    for (const kind of PICKUP_KINDS) {
      expect(isOverhead(kind)).toBe(false);
    }
  });
});
