/** 轻量灰度浮点图（反射率 0..1），Node/浏览器通用，不依赖 ImageData */
export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

export function createGray(width: number, height: number, fill = 0): GrayImage {
  return { width, height, data: new Float32Array(width * height).fill(fill) };
}

/**
 * 覆盖率光栅化器：在 coverage 缓冲上画抗锯齿粗线段，
 * 同一墨水多次描笔画采用饱和叠加（min(1, a+b)）。
 */
export class CoverageRaster {
  width: number;
  height: number;
  cov: Float32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cov = new Float32Array(width * height);
  }

  segment(x0: number, y0: number, x1: number, y1: number, penWidth: number): void {
    const half = penWidth / 2;
    const aa = Math.max(0.8, penWidth * 0.18);
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - half - aa));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(x0, x1) + half + aa));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - half - aa));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(y0, y1) + half + aa));
    const vx = x1 - x0;
    const vy = y1 - y0;
    const len2 = vx * vx + vy * vy || 1e-9;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const t = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / len2));
        const px = x0 + vx * t;
        const py = y0 + vy * t;
        const d = Math.hypot(x - px, y - py);
        const c = Math.max(0, Math.min(1, (half + aa - d) / (2 * aa)));
        if (c <= 0) continue;
        const idx = y * this.width + x;
        const merged = this.cov[idx]! + c;
        this.cov[idx] = merged >= 1 ? 1 : merged;
      }
    }
  }

  path(points: Array<[number, number]>, penWidth: number): void {
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i]!;
      const [x1, y1] = points[i + 1]!;
      this.segment(x0, y0, x1, y1, penWidth);
    }
  }
}

/** 双线性采样（用于配准平移等） */
export function sampleBilinear(img: GrayImage, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const w = img.width;
  const h = img.height;
  const i00 = (Math.max(0, Math.min(h - 1, y0))) * w + Math.max(0, Math.min(w - 1, x0));
  const i10 = i00 + (x0 + 1 < w ? 1 : 0);
  const i01 = i00 + (y0 + 1 < h ? w : 0);
  const i11 = i01 + (x0 + 1 < w ? 1 : 0);
  const d = img.data;
  const a = d[i00]! * (1 - tx) + d[i10]! * tx;
  const b = d[i01]! * (1 - tx) + d[i11]! * tx;
  return a * (1 - ty) + b * ty;
}

/** 对整图做亚像素平移，输出新图 */
export function shiftImage(img: GrayImage, dx: number, dy: number): GrayImage {
  const out = createGray(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      out.data[y * img.width + x] = sampleBilinear(img, x - dx, y - dy);
    }
  }
  return out;
}
