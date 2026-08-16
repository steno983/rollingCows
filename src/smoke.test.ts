import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('esegue i test con vitest', () => {
    expect(1 + 1).toBe(2);
  });

  it('supporta la sintassi TypeScript moderna', () => {
    const values: readonly number[] = [1, 2, 3];
    const doubled = values.map((value) => value * 2);
    expect(doubled).toEqual([2, 4, 6]);
  });
});
