/**
 * 两端元非负最小二乘（NNLS）解析解 —— CPU 参考实现。
 *
 * 模型（吸光度空间，逐波段带权重 w_b）：
 *   最小化  Σ_b w_b ( y_b - a1_b·c1 - a2_b·c2 )²   且 c1,c2 ≥ 0
 *
 * 二维情形只有 4 个候选活动集：{1,2}、{1}、{2}、{}，
 * 全部解析求出后取残差最小的可行解，等价于 NNLS 且无迭代、可逐像素向量化。
 * GLSL 片元着色器中的实现与此逐行对应（见 glsl/nnmix.ts），单测交叉验证两者一致。
 */
import type { BandWeights, Vec6 } from './types';

export interface NnlsResult {
  c1: number;
  c2: number;
  /** 加权残差平方和 */
  rss: number;
}

export function nnls2(
  y: Vec6,
  a1: Vec6,
  a2: Vec6,
  w: BandWeights = [1, 1, 1, 1, 1, 1],
): NnlsResult {
  // 加权内积
  let y1 = 0,
    y2 = 0,
    g11 = 0,
    g22 = 0,
    g12 = 0;
  for (let b = 0; b < 6; b++) {
    const wb = w[b]!;
    y1 += wb * y[b]! * a1[b]!;
    y2 += wb * y[b]! * a2[b]!;
    g11 += wb * a1[b]! * a1[b]!;
    g22 += wb * a2[b]! * a2[b]!;
    g12 += wb * a1[b]! * a2[b]!;
  }

  const eps = 1e-12;
  g11 = Math.max(g11, eps);
  g22 = Math.max(g22, eps);

  const candidates: [number, number][] = [];

  // 活动集 {1,2}：2x2 正规方程
  const det = g11 * g22 - g12 * g12;
  if (Math.abs(det) > eps) {
    const c1 = (y1 * g22 - y2 * g12) / det;
    const c2 = (y2 * g11 - y1 * g12) / det;
    if (c1 >= -1e-9 && c2 >= -1e-9) candidates.push([Math.max(0, c1), Math.max(0, c2)]);
  }

  // 活动集 {1}
  candidates.push([Math.max(0, y1 / g11), 0]);
  // 活动集 {2}
  candidates.push([0, Math.max(0, y2 / g22)]);
  // 活动集 {}
  candidates.push([0, 0]);

  let best: NnlsResult = { c1: 0, c2: 0, rss: Infinity };
  for (const [c1, c2] of candidates) {
    let rss = 0;
    for (let b = 0; b < 6; b++) {
      const d = y[b]! - c1 * a1[b]! - c2 * a2[b]!;
      rss += w[b]! * d * d;
    }
    if (rss < best.rss) best = { c1, c2, rss };
  }
  return best;
}

/** 反射率 -> 相对纸张的吸光度向量 */
export function reflectanceToAbsorbance(r: Vec6, paper: Vec6): Vec6 {
  return r.map((v, i) => -Math.log(Math.max(v, 1e-4) / Math.max(paper[i]!, 1e-4))) as Vec6;
}
