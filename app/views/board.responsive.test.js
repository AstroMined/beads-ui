import { describe, expect, test } from 'vitest';
import { computeColMinWidth } from './board.js';

describe('computeColMinWidth', () => {
  const gap = 16;
  const padding = 12;

  test('5 columns on 1920px viewport', () => {
    const result = computeColMinWidth(1920, 5, gap, padding);
    // available = 1920 - 4*16 - 2*12 = 1920 - 64 - 24 = 1832
    // per col = floor(1832 / 5) = floor(366.4) = 366
    expect(result).toBe(366);
  });

  test('8 columns on 1920px viewport', () => {
    const result = computeColMinWidth(1920, 8, gap, padding);
    // available = 1920 - 7*16 - 2*12 = 1920 - 112 - 24 = 1784
    // per col = floor(1784 / 8) = floor(223) = 223
    expect(result).toBe(223);
  });

  test('10 columns on 1920px viewport hits 180px floor', () => {
    const result = computeColMinWidth(1920, 10, gap, padding);
    // available = 1920 - 9*16 - 2*12 = 1920 - 144 - 24 = 1752
    // per col = floor(1752 / 10) = floor(175.2) = 175 -> clamped to 180
    expect(result).toBe(180);
  });

  test('12 columns on 1920px viewport hits 180px floor', () => {
    const result = computeColMinWidth(1920, 12, gap, padding);
    // available = 1920 - 11*16 - 2*12 = 1920 - 176 - 24 = 1720
    // per col = floor(1720 / 12) = floor(143.3) = 143 -> clamped to 180
    expect(result).toBe(180);
  });

  test('1 column returns full available width', () => {
    const result = computeColMinWidth(1920, 1, gap, padding);
    // available = 1920 - 0*16 - 2*12 = 1920 - 24 = 1896
    expect(result).toBe(1896);
  });

  test('0 columns returns viewportWidth', () => {
    const result = computeColMinWidth(1920, 0, gap, padding);
    expect(result).toBe(1920);
  });

  test('negative column count returns viewportWidth', () => {
    const result = computeColMinWidth(1920, -1, gap, padding);
    expect(result).toBe(1920);
  });
});
