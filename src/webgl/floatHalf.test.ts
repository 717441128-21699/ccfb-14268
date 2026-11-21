import { describe, expect, it } from 'vitest';
import { floatToHalf } from './floatHalf';

/** half 位模式手动转回 float32（测试用，不依赖 Float16Array） */
function halfToFloat(h: number): number {
  const sign = (h & 0x8000) ? -1 : 1;
  const exp = (h >>> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * Math.pow(2, -14) * (mant / 1024);
  if (exp === 31) return mant === 0 ? sign * Infinity : NaN;
  return sign * Math.pow(2, exp - 15) * (1 + mant / 1024);
}

describe('float32 -> float16', () => {
  const back = (v: number) => halfToFloat(floatToHalf(v));

  it('边界与常用值往返误差 < 0.1%', () => {
    for (const v of [0, 0.01, 0.05, 0.1, 0.25, 0.5, 0.86, 0.96, 1]) {
      const h = back(v);
      expect(Math.abs(h - v)).toBeLessThan(v * 0.001 + 1e-4);
    }
  });

  it('暗部反射率保持单调', () => {
    let prev = -1;
    for (let v = 0.005; v <= 0.2; v += 0.005) {
      const h = back(v);
      expect(h).toBeGreaterThan(prev);
      prev = h;
    }
  });
});
