/** 合成样本真值的运行时保存（与 bandStore 平行，真实导入文书为 null） */
import type { GroundTruth } from '../core/types';

const gtStore = new Map<string, GroundTruth>();

export function setGroundTruth(projectId: string, gt: GroundTruth): void {
  gtStore.set(projectId, gt);
}
export function getGroundTruth(projectId: string): GroundTruth | null {
  return gtStore.get(projectId) ?? null;
}
