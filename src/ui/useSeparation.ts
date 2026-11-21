import { useEffect, useRef, useState } from 'react';
import { SeparationEngine } from '../webgl/SeparationEngine';
import type { DocProject, Roi, SeparationMetrics } from '../core/types';
import type { GrayImage } from '../core/raster';
import { evaluateSeparation, type AbundanceMaps } from '../core/metrics';
import type { GroundTruth } from '../core/types';
import { PAPER_REFLECTANCE } from '../core/spectra';

const MODE_TO_INT = { ink1: 0, ink2: 1, split: 2, residual: 3, rgb: 4 } as const;

export interface SeparationRun {
  elapsedMs: number;
  metrics: (Omit<SeparationMetrics, 'elapsedMs'> & { elapsedMs: number }) | null;
}

/**
 * 驱动 WebGL2 分离引擎：上传波段、按项目参数分离、按显示模式渲染。
 * groundTruth 存在时（合成样本）自动给出串色率等评测指标。
 */
export function useSeparation(
  project: DocProject,
  bands: GrayImage[] | undefined,
  groundTruth: GroundTruth | null,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SeparationEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<SeparationRun | null>(null);
  const [gpuReady, setGpuReady] = useState(false);
  const roisRef = useRef<Roi[]>(project.rois);
  roisRef.current = project.rois;

  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      engineRef.current = new SeparationEngine(canvasRef.current);
      setGpuReady(true);
    } catch (e) {
      setError((e as Error).message);
    }
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !bands) return;
    const canvas = canvasRef.current!;
    canvas.width = bands[0]!.width;
    canvas.height = bands[0]!.height;
    engine.uploadBands(bands);

    const t0 = performance.now();
    const gpuMs = engine.separate({
      a1: project.endmember1.absorbance,
      a2: project.endmember2.absorbance,
      paper: PAPER_REFLECTANCE,
      globalWeights: project.globalWeights,
      rois: roisRef.current,
    });
    engine.renderDisplay({
      mode: MODE_TO_INT[project.displayMode],
      gain: 1.4,
      ink1Color: [1.0, 0.35, 0.37],
      ink2Color: [0.22, 0.82, 0.85],
    });
    const totalMs = performance.now() - t0;

    if (groundTruth) {
      // 评测走回读（仅合成样本有真值；真实文书无掩膜，不产生指标）
      const maps = engine.readMaps();
      const abundance: AbundanceMaps = {
        c1: maps.c1,
        c2: maps.c2,
        residual: maps.residual,
        width: maps.width,
        height: maps.height,
      };
      const m = evaluateSeparation(abundance, groundTruth);
      setRun({ elapsedMs: totalMs, metrics: { ...m, elapsedMs: totalMs } });
    } else {
      setRun({ elapsedMs: totalMs, metrics: null });
    }
    void gpuMs;
  }, [
    bands,
    project.endmember1,
    project.endmember2,
    project.globalWeights,
    project.rois,
    project.displayMode,
    groundTruth,
  ]);

  return { canvasRef, error, run, gpuReady, engineRef };
}
