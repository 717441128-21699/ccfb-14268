/**
 * 全局类型定义 —— 多波段文书墨水分层检验
 */

/** 六个成像波段（与文检仪多波段光源对应） */
export interface BandDef {
  id: string;
  /** 简称，如 UV */
  short: string;
  /** 中文名 */
  name: string;
  /** 中心波长 nm */
  wavelengthNm: number;
  /** UI 上的代表色 */
  color: string;
  /** 说明 */
  note: string;
}

/** 6 维向量（按 BANDS 顺序） */
export type Vec6 = [number, number, number, number, number, number];

/** 各波段权重（ROI 内可调） */
export type BandWeights = Vec6;

/** 矩形框选区域，坐标使用 0..1 归一化，与分辨率解耦 */
export interface Roi {
  id: string;
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 该区域内各波段权重，默认全 1 */
  weights: BandWeights;
  visible: boolean;
  color: string;
}

/** 端元（一种墨水的光谱特征） */
export interface Endmember {
  id: string;
  /** 取自光谱库时的墨水 id；自定义采样为 custom */
  inkId: string;
  label: string;
  /** 吸光度向量 k = -ln(R_ink / R_paper)，按 BANDS 顺序 */
  absorbance: Vec6;
  /** 来源：library 光谱库 / sample 图像采样 / manual 手工录入 */
  source: 'library' | 'sample' | 'manual';
}

export type LayerDisplayMode =
  | 'ink1' // 仅墨水1丰度层
  | 'ink2' // 仅墨水2丰度层
  | 'split' // 双色分屏叠加（红=墨水1，青=墨水2）
  | 'residual' // 拟合残差（异常/未建模成分）
  | 'rgb'; // 原始可见光合成（470/535/625）

export interface BandOffset {
  /** 相对基准波段的像素偏移（以全图分辨率计） */
  dx: number;
  dy: number;
}

export interface Annotation {
  id: string;
  /** 标注形态 */
  kind: 'rect' | 'arrow' | 'text';
  /** 归一化坐标点（rect 用两点，arrow 用两点，text 用首点） */
  points: { x: number; y: number }[];
  text: string;
  color: string;
  createdAt: number;
}

/** 单份文书的检验工程 */
export interface DocProject {
  id: string;
  caseId: string;
  title: string;
  width: number;
  height: number;
  /** 每波段一张图的 ImageData（不持久化到 IndexedDB，仅运行时） */
  bandImageIds: string[];
  /** 波段配准偏移，索引 0 为基准（恒为 0） */
  offsets: BandOffset[];
  endmember1: Endmember;
  endmember2: Endmember;
  rois: Roi[];
  annotations: Annotation[];
  displayMode: LayerDisplayMode;
  /** 全局各波段权重（ROI 外生效） */
  globalWeights: BandWeights;
  createdAt: number;
  updatedAt: number;
}

export interface CaseFile {
  id: string;
  caseNo: string;
  title: string;
  examiner: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

/** 合成样本的真值（用于串色率等定量评测） */
export interface GroundTruth {
  /** 墨水1 覆盖掩膜，Uint8，255=该墨水覆盖 */
  mask1: Uint8Array;
  /** 墨水2 覆盖掩膜 */
  mask2: Uint8Array;
  width: number;
  height: number;
}

/** 分离质量指标 */
export interface SeparationMetrics {
  /** 墨水1 层中墨水2 区域的串色比例（0..1） */
  crossColor1to2: number;
  /** 墨水2 层中墨水1 区域的串色比例 */
  crossColor2to1: number;
  /** 综合串色率（加权平均） */
  crossColor: number;
  /** 平均拟合残差（吸光度空间） */
  meanResidual: number;
  /** 纸张区域误判率（纸被判成墨的像素占比） */
  paperFalsePositive: number;
  /** 计算耗时 ms */
  elapsedMs: number;
}

/** 合成样本场景定义 */
export interface SyntheticScenario {
  id: string;
  name: string;
  description: string;
  ink1Id: string;
  ink2Id: string;
}
