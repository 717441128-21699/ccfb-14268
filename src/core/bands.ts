import type { BandDef } from './types';

/**
 * 标准六个成像波段。
 * 顺序即纹理数组 layer 索引，也是所有 Vec6 的下标顺序，全局固定不可调换。
 */
export const BANDS: BandDef[] = [
  {
    id: 'uv365',
    short: 'UV',
    name: '紫外 365nm',
    wavelengthNm: 365,
    color: '#8b5cf6',
    note: '长波紫外，荧光/消光差异',
  },
  {
    id: 'blue420',
    short: 'B420',
    name: '蓝光 420nm',
    wavelengthNm: 420,
    color: '#60a5fa',
    note: '蓝紫光，蓝色染料吸收特征',
  },
  {
    id: 'blue470',
    short: 'B470',
    name: '蓝光 470nm',
    wavelengthNm: 470,
    color: '#3b82f6',
    note: '蓝光通道（合成 RGB 之蓝）',
  },
  {
    id: 'green535',
    short: 'G535',
    name: '绿光 535nm',
    wavelengthNm: 535,
    color: '#22c55e',
    note: '绿光通道（合成 RGB 之绿）',
  },
  {
    id: 'red625',
    short: 'R625',
    name: '红光 625nm',
    wavelengthNm: 625,
    color: '#ef4444',
    note: '红光通道（合成 RGB 之红）',
  },
  {
    id: 'nir850',
    short: 'NIR',
    name: '红外 850nm',
    wavelengthNm: 850,
    color: '#94a3b8',
    note: '近红外，染料型墨水常变透明——区分同色异谱笔墨的关键',
  },
];

export const BAND_COUNT = BANDS.length;

/** 合成 RGB 预览所用波段下标（R/G/B） */
export const RGB_BAND_INDEX = { r: 4, g: 3, b: 2 } as const;
