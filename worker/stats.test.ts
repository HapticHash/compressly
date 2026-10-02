import { describe, expect, it } from 'vitest';
import { isValidCount } from './stats';

describe('isValidCount', () => {
  it('accepts non-negative integers up to the limit', () => {
    expect(isValidCount(0, 10)).toBe(true);
    expect(isValidCount(10, 10)).toBe(true);
  });

  it('rejects strings, negatives, fractions and values over the limit', () => {
    for (const value of ['5', -1, 1.5, 11, NaN, null]) {
      expect(isValidCount(value, 10)).toBe(false);
    }
  });
});
