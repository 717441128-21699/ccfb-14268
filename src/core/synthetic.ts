/**
 * 合成多波段文书样本生成器。
 *
 * 成像模型（每波段 b、每像素 p）：
 *   覆盖率 c1,c2 由笔画光栅化得到（两种墨水交叠处均保留，模拟后加笔覆盖原字）；
 *   A_b(p) = k1_b·c1 + k2_b·c2                         （Beer–Lambert 线性混合）
 *   R_b(p) = paperTex_b(p) · exp(-A_b) + sensorNoise
 * 同时输出真值掩膜 mask1/mask2，供串色率等指标定量评测。
 */
import type { GroundTruth, SyntheticScenario } from './types';
import { BANDS } from './bands';
import { getInk, inkAbsorbance, PAPER_REFLECTANCE } from './spectra';
import { CoverageRaster, createGray, type GrayImage, shiftImage } from './raster';
import { getGlyph } from './glyphs';
import { clamp, gaussian, mulberry32 } from './util';

const HAS_CANVAS = typeof document !== 'undefined' && typeof document.createElement === 'function';

/** 浏览器环境的单字离屏画布（懒加载复用） */
let glyphCanvas: HTMLCanvasElement | null = null;
let glyphCtx: CanvasRenderingContext2D | null = null;
function getGlyphCtx(cell: number): CanvasRenderingContext2D | null {
  if (!HAS_CANVAS) return null;
  if (!glyphCanvas) {
    glyphCanvas = document.createElement('canvas');
    glyphCtx = glyphCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (glyphCanvas!.width !== cell) {
    glyphCanvas!.width = cell;
    glyphCanvas!.height = cell;
  }
  return glyphCtx;
}

export interface SyntheticDoc {
  width: number;
  height: number;
  /** 六波段反射率灰度图，顺序与 BANDS 一致 */
  bands: GrayImage[];
  groundTruth: GroundTruth;
  scenario: SyntheticScenario;
  seed: number;
}

export const SYNTHETIC_SCENARIOS: SyntheticScenario[] = [
  {
    id: 'tamper-overwrite',
    name: '同色笔涂改描红',
    description:
      '原件用黑色签字笔（颜料型）书写，后用黑色中性笔（染料型）在原字上描改并添字；两墨目视同色，红外下染料透明、颜料显现。',
    ink1Id: 'black-sign-pigment',
    ink2Id: 'black-gel-dye',
  },
  {
    id: 'amount-alter',
    name: '金额数字篡改',
    description: '“叁万元整”被描改为“叁拾万元整”，原字笔画与后加笔画交叠，逐像素解混还原底层原字。',
    ink1Id: 'blueblack-fountain',
    ink2Id: 'blue-ballpoint',
  },
  {
    id: 'seal-overlap',
    name: '印文与字迹交叠',
    description: '红色印泥盖印压过黑色签名，检验印泥层与墨层的先后及分离保真度。',
    ink1Id: 'black-gel-dye',
    ink2Id: 'red-seal-ink',
  },
];

interface DrawTextOptions {
  x: number;
  y: number;
  size: number;
  gap: number;
  jitter: number;
  rand: () => number;
}

/** Node 环境回退：笔画骨架光栅化（测试仅验证数学，不要求字形美观） */
function drawTextStrokes(ras: CoverageRaster, text: string, opts: DrawTextOptions): number {
  const { size, gap, jitter, rand } = opts;
  let x = opts.x;
  let y = opts.y;
  const pen = size * 0.14;
  const scale = size / 100;
  for (const ch of text) {
    if (ch === '\n') { x = opts.x; y += size * 1.5; continue; }
    if (x + size > ras.width - 40) { x = opts.x; y += size * 1.5; }
    const jx = (rand() - 0.5) * jitter * size;
    const jy = (rand() - 0.5) * jitter * size;
    for (const stroke of getGlyph(ch)) {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < stroke.length; i += 2) {
        pts.push([x + jx + stroke[i]! * scale, y + jy + stroke[i + 1]! * scale]);
      }
      ras.path(pts, pen);
    }
    x += size + gap;
  }
  return y;
}

/**
 * 浏览器环境：系统 CJK 字体逐字光栅化，alpha 作为笔画覆盖率，
 * 叠加轻微位置/字号抖动模拟书写差异，保证文本可读、笔画连续。
 */
function drawTextCanvas(ras: CoverageRaster, text: string, opts: DrawTextOptions): number {
  const { size, gap, jitter, rand } = opts;
  const cell = Math.ceil(size * 1.15) + 8;
  const ctx = getGlyphCtx(cell);
  if (!ctx) return drawTextStrokes(ras, text, opts);
  let x = opts.x;
  let y = opts.y;
  for (const ch of text) {
    if (ch === '\n') { x = opts.x; y += size * 1.5; continue; }
    if (ch === ' ') { x += size * 0.5; continue; }
    if (x + size > ras.width - 40) { x = opts.x; y += size * 1.5; }
    const jx = (rand() - 0.5) * jitter * size;
    const jy = (rand() - 0.5) * jitter * size;
    const fs = Math.round(size * 0.94 * (1 + (rand() - 0.5) * jitter * 0.3));

    ctx.clearRect(0, 0, cell, cell);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${fs}px "KaiTi","STKaiti","FangSong","SimSun",serif`;
    ctx.fillText(ch, 4, 4);
    const img = ctx.getImageData(0, 0, cell, cell).data;

    const baseX = Math.round(x + jx);
    const baseY = Math.round(y + jy);
    for (let gy = 0; gy < cell; gy++) {
      for (let gx = 0; gx < cell; gx++) {
        const a = img[(gy * cell + gx) * 4 + 3]!;
        if (a < 24) continue;
        const px = baseX + gx;
        const py = baseY + gy;
        if (px < 0 || px >= ras.width || py < 0 || py >= ras.height) continue;
        const cov = (a / 255) * 0.95;
        const idx = py * ras.width + px;
        const merged = ras.cov[idx]! + cov;
        ras.cov[idx] = merged >= 1 ? 1 : merged;
      }
    }
    x += size + gap;
  }
  return y;
}

function drawText(ras: CoverageRaster, text: string, opts: DrawTextOptions): number {
  return HAS_CANVAS ? drawTextCanvas(ras, text, opts) : drawTextStrokes(ras, text, opts);
}

/** 纸张纹理：低频云斑 + 纤维走向 + 颗粒，逐波段略有差异 */
function buildPaperTextures(
  width: number,
  height: number,
  rand: () => number,
): GrayImage[] {
  const base = createGray(width, height);
  const grain = createGray(width, height);
  // 低频云斑：低分辨率噪声上采样
  const gw = Math.max(8, Math.round(width / 64));
  const gh = Math.max(8, Math.round(height / 64));
  const cloud = new Float32Array(gw * gh);
  for (let i = 0; i < cloud.length; i++) cloud[i] = (rand() - 0.5) * 0.07;
  // 纤维：细短亮/暗线
  for (let i = 0; i < (width * height) / 900; i++) {
    const fx = rand() * width;
    const fy = rand() * height;
    const len = 4 + rand() * 14;
    const ang = (rand() - 0.5) * 0.5;
    const bright = rand() > 0.5 ? 0.025 : -0.02;
    const steps = 3;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps - 0.5;
      const px = Math.round(fx + Math.cos(ang) * len * t);
      const py = Math.round(fy + Math.sin(ang) * len * t);
      if (px >= 0 && px < width && py >= 0 && py < height) {
        grain.data[py * width + px]! += bright;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx = Math.min(gw - 1, Math.floor((x / width) * gw));
      const cy = Math.min(gh - 1, Math.floor((y / height) * gh));
      const c = cloud[cy * gw + cx]!;
      const g = grain.data[y * width + x]! + (rand() - 0.5) * 0.012;
      base.data[y * width + x] = c + g;
    }
  }
  return BANDS.map((_, b) => {
    const img = createGray(width, height);
    const bandTint = (rand() - 0.5) * 0.012;
    for (let i = 0; i < img.data.length; i++) {
      img.data[i] = clamp(PAPER_REFLECTANCE[b]! + base.data[i]! + bandTint, 0.02, 0.99);
    }
    return img;
  });
}

export interface GenerateOptions {
  width?: number;
  height?: number;
  seed?: number;
  /** 传感器高斯噪声标准差（反射率单位），默认 0.012 */
  noiseSigma?: number;
  /** 可选：波段间亚像素错位（dx,dy），索引 0 应为 0；用于配准验证 */
  bandShifts?: Array<{ dx: number; dy: number }>;
}

const DEFAULT_SIZE = { width: 794, height: 1123 }; // A4 @ ~96dpi 基准画布

export function generateSyntheticDoc(
  scenario: SyntheticScenario,
  opts: GenerateOptions = {},
): SyntheticDoc {
  const width = opts.width ?? DEFAULT_SIZE.width;
  const height = opts.height ?? DEFAULT_SIZE.height;
  const seed = opts.seed ?? 20261121;
  const noiseSigma = opts.noiseSigma ?? 0.012;
  const rand = mulberry32(seed);

  const ink1 = getInk(scenario.ink1Id);
  const ink2 = getInk(scenario.ink2Id);
  const k1 = inkAbsorbance(ink1);
  const k2 = inkAbsorbance(ink2);

  const ras1 = new CoverageRaster(width, height);
  const ras2 = new CoverageRaster(width, height);
  const titleSize = Math.round(width * 0.052);
  const bodySize = Math.round(width * 0.042);

  if (scenario.id === 'tamper-overwrite') {
    drawText(ras1, '借款合同', { x: width * 0.36, y: height * 0.1, size: titleSize, gap: bodySize * 0.4, jitter: 0.05, rand });
    drawText(ras1, '今借到人民币叁万元整\n借款人：王民\n日期：2026年1月5日', {
      x: width * 0.12, y: height * 0.24, size: bodySize, gap: bodySize * 0.28, jitter: 0.05, rand,
    });
    // 后加笔：在“万”字位置描“拾”，并改写金额行
    const tamperY = height * 0.24 + bodySize * 1.5 + bodySize * 0.15;
    drawText(ras2, '拾', { x: width * 0.42, y: tamperY, size: bodySize, gap: 0, jitter: 0.07, rand });
    drawText(ras2, '（已收）', { x: width * 0.62, y: height * 0.24 + bodySize * 3.1, size: bodySize * 0.9, gap: bodySize * 0.24, jitter: 0.06, rand });
  } else if (scenario.id === 'amount-alter') {
    drawText(ras1, '收款凭证', { x: width * 0.36, y: height * 0.1, size: titleSize, gap: bodySize * 0.4, jitter: 0.05, rand });
    drawText(ras1, '金额：叁万元整\n合计：30000元\n收款人：李金', {
      x: width * 0.12, y: height * 0.24, size: bodySize, gap: bodySize * 0.28, jitter: 0.05, rand,
    });
    const lineY = height * 0.24 + bodySize * 1.5 + bodySize * 0.15;
    drawText(ras2, '拾', { x: width * 0.36, y: lineY, size: bodySize, gap: 0, jitter: 0.04, rand });
    drawText(ras2, '0', { x: width * 0.4, y: lineY + bodySize * 1.5, size: bodySize * 1.05, gap: 0, jitter: 0.06, rand });
  } else {
    drawText(ras1, '借款合同', { x: width * 0.36, y: height * 0.1, size: titleSize, gap: bodySize * 0.4, jitter: 0.05, rand });
    drawText(ras1, '借款人：王民\n日期：2026年3月8日', {
      x: width * 0.12, y: height * 0.3, size: bodySize, gap: bodySize * 0.28, jitter: 0.05, rand,
    });
    // 圆形印章 + 印文（用印泥墨水画圆与环内字）
    const cx = width * 0.5;
    const cy = height * 0.34;
    const r = width * 0.16;
    const ring = new CoverageRaster(width, height);
    for (let a = 0; a < Math.PI * 2; a += 0.02) {
      ring.segment(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(a + 0.03) * r, cy + Math.sin(a + 0.03) * r, r * 0.05);
    }
    drawText(ring, '合 计 公 司', { x: cx - r * 0.72, y: cy - bodySize * 0.6, size: bodySize * 0.8, gap: bodySize * 0.2, jitter: 0.04, rand });
    ras2.cov.set(ring.cov);
  }

  const paper = buildPaperTextures(width, height, rand);
  const bands: GrayImage[] = paper.map(() => createGray(width, height));
  const n = width * height;
  for (let b = 0; b < BANDS.length; b++) {
    const out = bands[b]!.data;
    const pb = paper[b]!.data;
    for (let i = 0; i < n; i++) {
      const c1 = ras1.cov[i]!;
      const c2 = ras2.cov[i]!;
      const absorb = k1[b]! * c1 + k2[b]! * c2;
      const v = pb[i]! * Math.exp(-absorb) + gaussian(rand) * noiseSigma;
      out[i] = clamp(v, 0.01, 1);
    }
  }

  const shifted = opts.bandShifts
    ? bands.map((img, b) => {
        const s = opts.bandShifts![b]!;
        return s.dx === 0 && s.dy === 0 ? img : shiftImage(img, s.dx, s.dy);
      })
    : bands;

  const mask1 = new Uint8Array(n);
  const mask2 = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    mask1[i] = ras1.cov[i]! > 0.2 ? 255 : 0;
    mask2[i] = ras2.cov[i]! > 0.2 ? 255 : 0;
  }

  return {
    width,
    height,
    bands: shifted,
    groundTruth: { mask1, mask2, width, height },
    scenario,
    seed,
  };
}

/** 把灰度反射率图转成可显示的 ImageData（Gamma 校正） */
export function grayToImageData(img: GrayImage, gamma = 0.6): ImageData {
  const out = new ImageData(img.width, img.height);
  for (let i = 0; i < img.data.length; i++) {
    const v = Math.round(clamp(Math.pow(img.data[i]!, gamma), 0, 1) * 255);
    out.data[i * 4] = v;
    out.data[i * 4 + 1] = v;
    out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** 三个波段合成 RGB ImageData */
export function bandsToRgb(
  bands: GrayImage[],
  ri: number,
  gi: number,
  bi: number,
  gamma = 0.7,
): ImageData {
  const w = bands[0]!.width;
  const h = bands[0]!.height;
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    out.data[i * 4] = Math.round(clamp(Math.pow(bands[ri]!.data[i]!, gamma), 0, 1) * 255);
    out.data[i * 4 + 1] = Math.round(clamp(Math.pow(bands[gi]!.data[i]!, gamma), 0, 1) * 255);
    out.data[i * 4 + 2] = Math.round(clamp(Math.pow(bands[bi]!.data[i]!, gamma), 0, 1) * 255);
    out.data[i * 4 + 3] = 255;
  }
  return out;
}
