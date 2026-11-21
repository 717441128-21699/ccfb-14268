/**
 * 检验结论页导出：把当前显示画面（含标注）连同案件信息、分离指标
 * 排版到一张报告 canvas，导出 PNG；同时可导出 JSON 检验记录。
 */
import type { CaseFile, DocProject, SeparationMetrics } from '../core/types';
import { BANDS } from '../core/bands';

const PAD = 48;
const BG = '#f4f6f8';
const INK = '#16202a';
const SUB = '#5b6b7b';
const ACCENT = '#0e6e96';

export interface ReportInput {
  caseFile: CaseFile;
  project: DocProject;
  /** 已渲染好分离结果的画布 */
  stageCanvas: HTMLCanvasElement;
  metrics: SeparationMetrics | null;
  conclusion: string;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function exportReportPng(input: ReportInput): void {
  const { caseFile, project, stageCanvas, metrics, conclusion } = input;
  const W = 1400;
  const stageW = 760;
  const stageH = Math.round((stageW * stageCanvas.height) / stageCanvas.width);
  const H = PAD * 2 + 760;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // 页眉
  ctx.fillStyle = INK;
  ctx.font = 'bold 30px "Microsoft YaHei", sans-serif';
  ctx.fillText('多波段墨水分离检验报告', PAD, PAD + 10);
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PAD, PAD + 28);
  ctx.lineTo(W - PAD, PAD + 28);
  ctx.stroke();

  // 左列：案件信息
  let y = PAD + 70;
  ctx.font = '18px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = INK;
  const info: [string, string][] = [
    ['案件编号', caseFile.caseNo],
    ['案件名称', caseFile.title],
    ['检验文书', project.title],
    ['检验员', caseFile.examiner || '—'],
    ['图像尺寸', `${project.width} × ${project.height} px`],
    ['成像波段', BANDS.map((b) => `${b.wavelengthNm}nm`).join(' / ')],
    ['墨水一端元', project.endmember1.label],
    ['墨水二端元', project.endmember2.label],
    ['ROI 数量', `${project.rois.length} 个`],
    ['报告时间', new Date().toLocaleString('zh-CN', { hour12: false })],
  ];
  for (const [k, v] of info) {
    ctx.fillStyle = SUB;
    ctx.font = '15px "Microsoft YaHei", sans-serif';
    ctx.fillText(k, PAD, y);
    ctx.fillStyle = INK;
    ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
    ctx.fillText(v, PAD + 96, y);
    y += 30;
  }

  if (metrics) {
    y += 12;
    ctx.fillStyle = ACCENT;
    ctx.font = 'bold 17px "Microsoft YaHei", sans-serif';
    ctx.fillText('定量评测（合成样本真值比对）', PAD, y);
    y += 30;
    const m: [string, string, boolean?][] = [
      ['综合串色率', `${(metrics.crossColor * 100).toFixed(2)} %（阈值 5%）`, metrics.crossColor < 0.05],
      ['墨水二→墨水一层泄漏', `${(metrics.crossColor2to1 * 100).toFixed(2)} %`, metrics.crossColor2to1 < 0.05],
      ['墨水一→墨水二层泄漏', `${(metrics.crossColor1to2 * 100).toFixed(2)} %`, metrics.crossColor1to2 < 0.05],
      ['纸张误判率', `${(metrics.paperFalsePositive * 100).toFixed(2)} %`, metrics.paperFalsePositive < 0.02],
      ['平均拟合残差', metrics.meanResidual.toFixed(4)],
      ['分离耗时', `${metrics.elapsedMs.toFixed(0)} ms（限值 3000 ms）`, metrics.elapsedMs < 3000],
    ];
    for (const [k, v, pass] of m) {
      ctx.fillStyle = SUB;
      ctx.font = '14px "Microsoft YaHei", sans-serif';
      ctx.fillText(k, PAD, y);
      ctx.fillStyle = pass === undefined ? INK : pass ? '#0f8a5f' : '#c0392b';
      ctx.font = 'bold 14px "Microsoft YaHei", sans-serif';
      ctx.fillText(v, PAD + 150, y);
      y += 27;
    }
  }

  // 检验结论
  y += 14;
  ctx.fillStyle = ACCENT;
  ctx.font = 'bold 17px "Microsoft YaHei", sans-serif';
  ctx.fillText('检验意见', PAD, y);
  y += 28;
  ctx.fillStyle = INK;
  ctx.font = '15px "Microsoft YaHei", sans-serif';
  for (const line of wrapText(ctx, conclusion || '（未填写）', stageW + 300)) {
    ctx.fillText(line, PAD, y);
    y += 24;
  }

  // 右列：分离结果图（当前显示模式，报告内标注随画布可见内容由 SVG 另行说明）
  const imgX = W - PAD - stageW;
  const imgY = PAD + 64;
  ctx.fillStyle = '#0a0e13';
  ctx.fillRect(imgX - 6, imgY - 6, stageW + 12, stageH + 12);
  ctx.drawImage(stageCanvas, imgX, imgY, stageW, stageH);
  ctx.fillStyle = SUB;
  ctx.font = '13px "Microsoft YaHei", sans-serif';
  const modeName: Record<string, string> = {
    ink1: '墨水一丰度层',
    ink2: '墨水二丰度层',
    split: '双墨水叠加层（红=墨水一，青=墨水二）',
    residual: '拟合残差图',
    rgb: '可见光 RGB 合成',
  };
  ctx.fillText(`图1　${modeName[project.displayMode] ?? ''}`, imgX, imgY + stageH + 26);

  // 标注清单
  let ay = imgY + stageH + 56;
  if (project.annotations.length > 0) {
    ctx.fillStyle = ACCENT;
    ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
    ctx.fillText('图上标注', imgX, ay);
    ay += 24;
    ctx.fillStyle = INK;
    ctx.font = '13px "Microsoft YaHei", sans-serif';
    project.annotations.forEach((a, i) => {
      const txt = `${i + 1}. [${a.kind === 'rect' ? '框' : a.kind === 'arrow' ? '箭头' : '文字'}] ${a.text || '（无文字）'}`;
      ctx.fillText(txt, imgX, ay);
      ay += 22;
    });
  }

  ctx.fillStyle = SUB;
  ctx.font = '12px "Microsoft YaHei", sans-serif';
  ctx.fillText('本报告由墨鉴多波段文书检验工作站生成，分离计算基于 WebGL2 逐像素非负最小二乘解混。', PAD, H - 24);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `检验报告_${caseFile.caseNo}_${project.title}.png`.replace(/[\\/:*?"<>|]/g, '_');
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

export function exportReportJson(input: ReportInput): void {
  const record = {
    exportedAt: new Date().toISOString(),
    case: {
      caseNo: input.caseFile.caseNo,
      title: input.caseFile.title,
      examiner: input.caseFile.examiner,
    },
    document: {
      title: input.project.title,
      width: input.project.width,
      height: input.project.height,
      displayMode: input.project.displayMode,
      endmember1: input.project.endmember1,
      endmember2: input.project.endmember2,
      globalWeights: input.project.globalWeights,
      rois: input.project.rois,
      annotations: input.project.annotations,
    },
    metrics: input.metrics,
    conclusion: input.conclusion,
  };
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `检验记录_${input.caseFile.caseNo}.json`.replace(/[\\/:*?"<>|]/g, '_');
  a.click();
  URL.revokeObjectURL(url);
}
