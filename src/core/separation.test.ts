import { describe, expect, it } from 'vitest';
import { nnls2, reflectanceToAbsorbance } from './nnls';
import { getInk, inkAbsorbance, PAPER_REFLECTANCE } from './spectra';
import { generateSyntheticDoc, SYNTHETIC_SCENARIOS } from './synthetic';
import { evaluateSeparation, separateCpu } from './metrics';

describe('NNLS 两端元解析解', () => {
  const a1: [number, number, number, number, number, number] = [1, 0.2, 0, 0.5, 0.1, 0];
  const a2: [number, number, number, number, number, number] = [0, 0.3, 1, 0.2, 0.6, 0.9];
  const w: [number, number, number, number, number, number] = [1, 1, 1, 1, 1, 1];

  it('无噪声混合可还原真实丰度', () => {
    const y = a1.map((v, b) => v * 0.7 + a2[b]! * 0.4) as typeof a1;
    const r = nnls2(y, a1, a2, w);
    expect(r.c1).toBeCloseTo(0.7, 5);
    expect(r.c2).toBeCloseTo(0.4, 5);
    expect(r.rss).toBeLessThan(1e-20);
  });

  it('纯端元不产生负丰度或对侧泄漏', () => {
    const y = a1.map((v) => v * 0.9) as typeof a1;
    const r = nnls2(y, a1, a2, w);
    expect(r.c1).toBeCloseTo(0.9, 5);
    expect(r.c2).toBeLessThan(1e-9);
  });

  it('零向量返回零丰度', () => {
    const r = nnls2([0, 0, 0, 0, 0, 0], a1, a2, w);
    expect(r.c1).toBe(0);
    expect(r.c2).toBe(0);
  });

  it('权重提升某波段后结果向该波段倾斜', () => {
    // 仅 a2 在第 3 波段有信号；给该波段大权重
    const y: typeof a1 = [0.1, 0.1, 0.5, 0.1, 0.1, 0.1];
    const r0 = nnls2(y, a1, a2, w);
    const r1 = nnls2(y, a1, a2, [1, 1, 5, 1, 1, 1]);
    expect(r1.c2).toBeGreaterThan(r0.c2);
  });

  it('反射率转吸光度满足 Beer-Lambert 线性', () => {
    const r1 = getInk('black-gel-dye');
    const k = inkAbsorbance(r1);
    const mixedR = PAPER_REFLECTANCE.map((p, b) => p * Math.exp(-k[b]! * 0.6)) as typeof PAPER_REFLECTANCE;
    const y = reflectanceToAbsorbance(mixedR, PAPER_REFLECTANCE);
    y.forEach((v, b) => expect(v).toBeCloseTo(k[b]! * 0.6, 5));
  });
});

describe.each(SYNTHETIC_SCENARIOS)('合成场景：$name', (scenario) => {
  it('串色率低于 5% 且纸张误判率低于 2%', () => {
    const doc = generateSyntheticDoc(scenario, { width: 320, height: 452, seed: 42 });
    const a1 = inkAbsorbance(getInk(scenario.ink1Id));
    const a2 = inkAbsorbance(getInk(scenario.ink2Id));
    const maps = separateCpu(doc.bands, a1, a2);
    const m = evaluateSeparation(maps, doc.groundTruth);
    expect(m.crossColor).toBeLessThan(0.05);
    expect(m.paperFalsePositive).toBeLessThan(0.02);
    expect(m.meanResidual).toBeLessThan(0.08);
  });
});
