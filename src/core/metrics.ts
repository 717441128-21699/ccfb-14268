/**
 * 分离质量定量评测（基于合成样本真值掩膜）。
 *
 * 串色率定义（与检验口径对齐）：
 *   对"只含墨水2"的像素（mask2 且非 mask1），墨水1 层丰度占该像素总墨量的比例均值，
 *   即墨水2 区域泄漏到墨水1 层的比例；另一方向对称。综合值取覆盖像素加权平均。
 */
import type { GroundTruth, SeparationMetrics, Vec6, BandWeights } from './types';
import { nnls2, reflectanceToAbsorbance } from './nnls';
import { PAPER_REFLECTANCE } from './spectra';
import type { GrayImage } from './raster';

export const ABUNDANCE_THRESHOLD = 0.12;

export interface AbundanceMaps {
  c1: Float32Array;
  c2: Float32Array;
  residual: Float32Array;
  width: number;
  height: number;
}

/** CPU 参考分离管线：六波段反射率图 -> 丰度图（与 GLSL 实现数学一致） */
export function separateCpu(
  bands: GrayImage[],
  a1: Vec6,
  a2: Vec6,
  weights: BandWeights = [1, 1, 1, 1, 1, 1],
  paper: Vec6 = PAPER_REFLECTANCE,
): AbundanceMaps {
  const width = bands[0]!.width;
  const height = bands[0]!.height;
  const n = width * height;
  const c1 = new Float32Array(n);
  const c2 = new Float32Array(n);
  const residual = new Float32Array(n);
  const refl: Vec6 = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let b = 0; b < 6; b++) refl[b] = bands[b]!.data[i]!;
    const y = reflectanceToAbsorbance(refl, paper);
    const r = nnls2(y, a1, a2, weights);
    c1[i] = r.c1;
    c2[i] = r.c2;
    let ss = 0;
    for (let b = 0; b < 6; b++) {
      const d = y[b]! - r.c1 * a1[b]! - r.c2 * a2[b]!;
      ss += d * d;
    }
    residual[i] = Math.sqrt(ss / 6);
  }
  return { c1, c2, residual, width, height };
}

export function evaluateSeparation(maps: AbundanceMaps, gt: GroundTruth): Omit<SeparationMetrics, 'elapsedMs'> {
  const n = maps.width * maps.height;
  let only1 = 0;
  let only2 = 0;
  let leak2to1 = 0; // 墨水1 区域里混进的墨水2 比例
  let leak1to2 = 0; // 墨水2 区域里混进的墨水1 比例
  let paperPixels = 0;
  let paperFp = 0;
  let residualSum = 0;

  for (let i = 0; i < n; i++) {
    const m1 = gt.mask1[i]! > 0;
    const m2 = gt.mask2[i]! > 0;
    const c1 = maps.c1[i]!;
    const c2 = maps.c2[i]!;
    const total = c1 + c2;
    residualSum += maps.residual[i]!;

    if (m1 && !m2) {
      only1++;
      if (total > 1e-6) leak2to1 += c2 / total;
    } else if (m2 && !m1) {
      only2++;
      if (total > 1e-6) leak1to2 += c1 / total;
    } else if (!m1 && !m2) {
      paperPixels++;
      if (c1 > ABUNDANCE_THRESHOLD || c2 > ABUNDANCE_THRESHOLD) paperFp++;
    }
  }

  const crossColor2to1 = only1 ? leak2to1 / only1 : 0;
  const crossColor1to2 = only2 ? leak1to2 / only2 : 0;
  const denom = only1 + only2;
  const crossColor = denom ? (leak2to1 + leak1to2) / denom : 0;

  return {
    crossColor1to2,
    crossColor2to1,
    crossColor,
    meanResidual: residualSum / n,
    paperFalsePositive: paperPixels ? paperFp / paperPixels : 0,
  };
}
