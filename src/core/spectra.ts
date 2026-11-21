import type { Vec6 } from './types';
import { BANDS } from './bands';

/** 一种墨水在若干波长上的光谱反射率（0..1），波长可任意，用时插值到 BANDS */
export interface InkSpec {
  id: string;
  name: string;
  kind: 'gel' | 'ballpoint' | 'fountain' | 'toner' | 'seal';
  /** 光谱采样点 [nm, reflectance]，按 nm 升序 */
  curve: [number, number][];
  note: string;
}

/** 纸张基线反射率（各波段），棉/木浆复合办公纸的典型值 */
export const PAPER_REFLECTANCE: Vec6 = [0.72, 0.82, 0.86, 0.9, 0.93, 0.96];

/**
 * 五类常见笔墨的光谱反射曲线。
 * 数值参考 Forensic Science 文献中染料/颜料型墨水的多波段成像典型形态构造，
 * 关键特征：
 *  - 蓝黑中性笔(染料)与黑色签字笔(颜料)在 470/535/625 反射率都很低（目视同为黑色），
 *    但染料在 850nm 近红外几乎完全透明（R≈0.92），颜料仍保持吸收（R≈0.10）——同色异谱，红外分离；
 *  - 蓝色圆珠笔在 625nm 开始抬升、850nm 透明；
 *  - 蓝黑钢笔（鞣酸铁）在紫外强吸收、红外中等吸收；
 *  - 激光碳粉全波段强吸收且近红外不透明；
 *  - 红色印泥在 535nm 以下强吸收、红光/红外高反射。
 */
export const INK_LIBRARY: InkSpec[] = [
  {
    id: 'black-gel-dye',
    name: '黑色中性笔（染料型）',
    kind: 'gel',
    note: '常见黑色水笔，近红外透明，涂改描红常用笔之一',
    curve: [
      [365, 0.18],
      [420, 0.1],
      [470, 0.08],
      [535, 0.09],
      [625, 0.12],
      [700, 0.45],
      [850, 0.92],
      [950, 0.95],
    ],
  },
  {
    id: 'black-sign-pigment',
    name: '黑色签字笔（颜料型）',
    kind: 'gel',
    note: '碳黑颜料，全波段吸收、近红外不透明；与染料型目视同色',
    curve: [
      [365, 0.06],
      [420, 0.05],
      [470, 0.05],
      [535, 0.06],
      [625, 0.07],
      [700, 0.08],
      [850, 0.1],
      [950, 0.11],
    ],
  },
  {
    id: 'blue-ballpoint',
    name: '蓝色圆珠笔（油基）',
    kind: 'ballpoint',
    note: '蓝紫染料，红光开始透过，近红外透明',
    curve: [
      [365, 0.22],
      [420, 0.12],
      [470, 0.16],
      [535, 0.28],
      [625, 0.55],
      [700, 0.78],
      [850, 0.93],
      [950, 0.95],
    ],
  },
  {
    id: 'blueblack-fountain',
    name: '蓝黑钢笔水（鞣酸铁）',
    kind: 'fountain',
    note: '紫外强吸收，红外仍有中等吸收，档案墨水',
    curve: [
      [365, 0.05],
      [420, 0.09],
      [470, 0.14],
      [535, 0.18],
      [625, 0.24],
      [700, 0.34],
      [850, 0.48],
      [950, 0.52],
    ],
  },
  {
    id: 'laser-toner',
    name: '激光打印碳粉',
    kind: 'toner',
    note: '碳粉熔融附着，全波段近不透明，纹理与书写墨水不同',
    curve: [
      [365, 0.04],
      [420, 0.035],
      [470, 0.035],
      [535, 0.04],
      [625, 0.045],
      [700, 0.05],
      [850, 0.06],
      [950, 0.07],
    ],
  },
  {
    id: 'red-seal-ink',
    name: '红色印泥',
    kind: 'seal',
    note: '短波长强吸收，红/红外高反射',
    curve: [
      [365, 0.12],
      [420, 0.1],
      [470, 0.11],
      [535, 0.16],
      [625, 0.62],
      [700, 0.8],
      [850, 0.92],
      [950, 0.94],
    ],
  },
];

function interpolate(curve: [number, number][], nm: number): number {
  if (nm <= curve[0]![0]) return curve[0]![1];
  for (let i = 0; i < curve.length - 1; i++) {
    const [n0, v0] = curve[i]!;
    const [n1, v1] = curve[i + 1]!;
    if (nm >= n0 && nm <= n1) {
      const t = (nm - n0) / (n1 - n0);
      return v0 + (v1 - v0) * t;
    }
  }
  return curve[curve.length - 1]![1];
}

/** 取某墨水在六个标准波段上的反射率 */
export function inkReflectance(ink: InkSpec): Vec6 {
  return BANDS.map((b) => interpolate(ink.curve, b.wavelengthNm)) as Vec6;
}

/**
 * 墨水相对纸张的吸光度向量 k = -ln(R_ink / R_paper)。
 * 分离在吸光度空间进行：纸张基线相除后，混合为线性加和（Beer–Lambert）。
 */
export function inkAbsorbance(ink: InkSpec): Vec6 {
  const r = inkReflectance(ink);
  return r.map((v, i) => -Math.log(Math.max(v, 1e-4) / PAPER_REFLECTANCE[i]!)) as Vec6;
}

export function getInk(id: string): InkSpec {
  const ink = INK_LIBRARY.find((i) => i.id === id);
  if (!ink) throw new Error(`未知墨水: ${id}`);
  return ink;
}
