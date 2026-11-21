/** 运行时波段图像仓库：GrayImage 不进 localStorage，仅内存保存 */
import type { GrayImage } from '../core/raster';

const bandStore = new Map<string, GrayImage[]>();

export function setBandImages(projectId: string, bands: GrayImage[]): void {
  bandStore.set(projectId, bands);
}

export function getBandImages(projectId: string): GrayImage[] | undefined {
  return bandStore.get(projectId);
}

export function clearBandImages(projectId: string): void {
  bandStore.delete(projectId);
}
