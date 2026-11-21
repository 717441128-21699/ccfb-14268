import { useMemo, useState } from 'react';
import type {
  Annotation,
  BandWeights,
  DocProject,
  LayerDisplayMode,
  Roi,
  SeparationMetrics,
} from '../core/types';
import { BANDS } from '../core/bands';
import { INK_LIBRARY, getInk, inkAbsorbance } from '../core/spectra';
import { getBandImages } from '../state/bandStore';
import { getGroundTruth } from '../state/gtStore';
import { uid } from '../core/util';
import { useApp } from './AppContext';
import { useSeparation } from './useSeparation';
import { StageCanvas, type StageTool } from './StageCanvas';
import { BandThumbs } from './BandThumbs';
import { WeightSliders } from './WeightSliders';
import { NewDocumentDialog } from './NewDocumentDialog';
import { exportReportJson, exportReportPng } from './reportExport';

const ROI_COLORS = ['#f472b6', '#fbbf24', '#a78bfa', '#34d399', '#fb923c', '#60a5fa', '#f87171', '#2dd4bf'];
const DISPLAY_MODES: Array<{ id: LayerDisplayMode; label: string }> = [
  { id: 'split', label: '双墨水叠加（红/青）' },
  { id: 'ink1', label: '墨水一层（原文墨）' },
  { id: 'ink2', label: '墨水二层（后加墨）' },
  { id: 'residual', label: '拟合残差图' },
  { id: 'rgb', label: '可见光 RGB 合成' },
];

export function WorkspacePage({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}) {
  const { state, dispatch } = useApp();
  const project = state.projects.find((p) => p.id === projectId);
  const [tool, setTool] = useState<StageTool>('select');
  const [selectedRoiId, setSelectedRoiId] = useState<string | null>(null);
  const [showNewDoc, setShowNewDoc] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [conclusion, setConclusion] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);

  const bands = useMemo(() => getBandImages(projectId), [projectId]);
  const groundTruth = useMemo(() => getGroundTruth(projectId), [projectId]);

  const patch = (p: Partial<DocProject>) => dispatch({ type: 'patchProject', id: projectId, patch: p });

  const { canvasRef, error, run } = useSeparation(project!, bands, groundTruth);

  if (!project) return <div className="page">文书不存在或已删除。</div>;
  const caseFile = state.cases.find((c) => c.id === project.caseId);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  const addRoi = (rect: { x0: number; y0: number; x1: number; y1: number }) => {
    if (project.rois.length >= 8) {
      flash('最多支持 8 个 ROI');
      return;
    }
    const roi: Roi = {
      id: uid('roi'),
      name: `区域 ${project.rois.length + 1}`,
      ...rect,
      weights: [...project.globalWeights] as BandWeights,
      visible: true,
      color: ROI_COLORS[project.rois.length % ROI_COLORS.length]!,
    };
    patch({ rois: [...project.rois, roi] });
    setSelectedRoiId(roi.id);
    setTool('select');
  };

  const updateRoi = (id: string, p: Partial<Roi>) => {
    patch({ rois: project.rois.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  };

  const addAnnotation = (a: Annotation) => {
    if (a.kind === 'text' && a.points[0]) {
      // 先落一个空文字标注，内联输入框确认后再补文字
      setPendingText(a.points[0]);
      patch({ annotations: [...project.annotations, a] });
      return;
    }
    patch({ annotations: [...project.annotations, a] });
  };

  const commitText = (text: string) => {
    if (!pendingText) return;
    const list = project.annotations;
    const last = list[list.length - 1];
    if (last && last.kind === 'text') {
      const trimmed = text.trim();
      patch({
        annotations: trimmed
          ? list.map((a) => (a.id === last.id ? { ...a, text: trimmed } : a))
          : list.filter((a) => a.id !== last.id),
      });
    }
    setPendingText(null);
    setTool('select');
  };

  const swapEndmembers = () =>
    patch({ endmember1: project.endmember2, endmember2: project.endmember1 });

  const setEndmemberInk = (slot: 1 | 2, inkId: string) => {
    const ink = getInk(inkId);
    const em = {
      id: uid('em'),
      inkId,
      label: `${slot === 1 ? '墨水一（原文）' : '墨水二（后加）'}：${ink.name}`,
      absorbance: [...inkAbsorbance(ink)] as BandWeights,
      source: 'library' as const,
    };
    patch(slot === 1 ? { endmember1: em } : { endmember2: em });
  };

  const runBenchmark = () => {
    if (run) flash(`本次分离耗时 ${run.elapsedMs.toFixed(0)} ms（限值 3000 ms）`);
  };

  const doExportPng = () => {
    if (!caseFile || !canvasRef.current) return;
    exportReportPng({
      caseFile,
      project,
      stageCanvas: canvasRef.current,
      metrics: (run?.metrics as SeparationMetrics | null) ?? null,
      conclusion,
    });
  };

  return (
    <div className="workspace">
      {/* 左栏：显示模式 + 波段 + 工具 */}
      <div className="side">
        <button onClick={onBack} style={{ marginBottom: 12 }}>← 返回案件列表</button>
        <h3>显示图层</h3>
        {DISPLAY_MODES.map((m) => (
          <button
            key={m.id}
            className={`mode-btn ${project.displayMode === m.id ? 'active' : ''}`}
            onClick={() => patch({ displayMode: m.id })}
          >
            {m.label}
          </button>
        ))}

        <h3>交互工具</h3>
        <div className="toolbar">
          <button className={tool === 'select' ? 'tool-btn active' : 'tool-btn'} onClick={() => setTool('select')}>浏览</button>
          <button className={tool === 'roi' ? 'tool-btn active' : 'tool-btn'} onClick={() => setTool('roi')}>框选 ROI</button>
          <button className={tool === 'rect' ? 'tool-btn active' : 'tool-btn'} onClick={() => setTool('rect')}>标注框</button>
          <button className={tool === 'arrow' ? 'tool-btn active' : 'tool-btn'} onClick={() => setTool('arrow')}>箭头</button>
          <button className={tool === 'text' ? 'tool-btn active' : 'tool-btn'} onClick={() => setTool('text')}>文字</button>
        </div>

        <h3>六波段原图（{BANDS.length}）</h3>
        {bands ? <BandThumbs bands={bands} /> : <div className="muted">图像未载入</div>}

        <h3>全局波段权重（ROI 外）</h3>
        <WeightSliders
          weights={project.globalWeights}
          onChange={(globalWeights) => patch({ globalWeights })}
        />
        <button onClick={() => patch({ globalWeights: [1, 1, 1, 1, 1, 1] })}>重置全局权重</button>
      </div>

      {/* 中央舞台 */}
      <div className="stage-col">
        <div className="topbar" style={{ borderBottom: '1px solid var(--border)', flex: '0 0 auto' }}>
          <div className="logo">墨<span>鉴</span></div>
          <div style={{ flex: 1 }}>
            <strong>{project.title}</strong>
            <span className="muted" style={{ marginLeft: 10 }}>{project.width}×{project.height}</span>
          </div>
          <div className="row">
            <button onClick={runBenchmark}>性能计时</button>
            <button onClick={() => setShowNewDoc(true)}>新建文书</button>
            <button className="primary" onClick={() => setShowReport(true)}>生成结论页</button>
          </div>
        </div>
        <StageCanvas
          width={project.width}
          height={project.height}
          rois={project.rois}
          selectedRoiId={selectedRoiId}
          annotations={project.annotations}
          tool={tool}
          onDrawRoi={addRoi}
          onAddAnnotation={addAnnotation}
          pendingText={pendingText}
          onCommitText={commitText}
          onCancelText={() => {
            const list = project.annotations;
            const last = list[list.length - 1];
            if (last && last.kind === 'text' && !last.text) {
              patch({ annotations: list.filter((a) => a.id !== last.id) });
            }
            setPendingText(null);
            setTool('select');
          }}
        >
          <canvas ref={canvasRef} className="stage-canvas" />
        </StageCanvas>
        {error && (
          <div className="toast" style={{ background: '#4a1d24', borderColor: '#7f2d38' }}>
            WebGL2 错误：{error}
          </div>
        )}
        {run && (
          <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 5, background: 'rgba(13,19,26,0.85)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}>
            GPU 分离耗时 <strong className={run.elapsedMs < 3000 ? 'good' : 'bad'}>{run.elapsedMs.toFixed(0)} ms</strong>
            {run.metrics && (
              <>　·　串色率 <strong className={run.metrics.crossColor < 0.05 ? 'good' : 'bad'}>
                {(run.metrics.crossColor * 100).toFixed(2)}%
              </strong></>
            )}
          </div>
        )}
      </div>

      {/* 右栏：端元 / ROI / 指标 */}
      <div className="side right">
        <h3>墨水端元</h3>
        <div className="form-field">
          <label style={{ color: 'var(--ink1)' }}>墨水一（原文层）</label>
          <select value={project.endmember1.inkId} onChange={(e) => setEndmemberInk(1, e.target.value)}>
            {INK_LIBRARY.map((ink) => <option key={ink.id} value={ink.id}>{ink.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label style={{ color: 'var(--ink2)' }}>墨水二（后加层）</label>
          <select value={project.endmember2.inkId} onChange={(e) => setEndmemberInk(2, e.target.value)}>
            {INK_LIBRARY.map((ink) => <option key={ink.id} value={ink.id}>{ink.name}</option>)}
          </select>
        </div>
        <button onClick={swapEndmembers} style={{ marginBottom: 8 }}>交换两层端元</button>
        <div className="muted">
          端元取光谱库吸光度向量 k=-ln(R墨/R纸)，可在 ROI 内通过波段权重做局部修正。
        </div>

        <h3>ROI 区域（{project.rois.length}/8）</h3>
        {project.rois.length === 0 && <div className="muted">选择左侧「框选 ROI」后在图上拖出区域，可单独调整该区域各波段权重。</div>}
        {project.rois.map((r) => (
          <div
            key={r.id}
            className={`roi-item ${r.id === selectedRoiId ? 'selected' : ''}`}
            onClick={() => setSelectedRoiId(r.id)}
          >
            <div className="roi-head">
              <span className="roi-swatch" style={{ background: r.color }} />
              <input
                value={r.name}
                style={{ flex: 1 }}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => updateRoi(r.id, { name: e.target.value })}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateRoi(r.id, { visible: !r.visible });
                }}
              >
                {r.visible ? '隐藏' : '显示'}
              </button>
              <button
                className="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  patch({ rois: project.rois.filter((x) => x.id !== r.id) });
                  if (selectedRoiId === r.id) setSelectedRoiId(null);
                }}
              >
                删
              </button>
            </div>
            {r.id === selectedRoiId && (
              <WeightSliders
                weights={r.weights}
                onChange={(weights) => updateRoi(r.id, { weights })}
              />
            )}
          </div>
        ))}

        <h3>标注（{project.annotations.length}）</h3>
        {project.annotations.length === 0 && <div className="muted">用标注框/箭头/文字工具在图上标记可疑笔画。</div>}
        {project.annotations.map((a, i) => (
          <div key={a.id} className="roi-item">
            <div className="roi-head">
              <strong style={{ flex: 1 }}>{i + 1}. {a.kind === 'rect' ? '框' : a.kind === 'arrow' ? '箭头' : '文字'}</strong>
              <button className="danger" onClick={() => patch({ annotations: project.annotations.filter((x) => x.id !== a.id) })}>删</button>
            </div>
            {a.kind === 'text' && (
              <input value={a.text} onChange={(e) =>
                patch({ annotations: project.annotations.map((x) => (x.id === a.id ? { ...x, text: e.target.value } : x)) })}
              />
            )}
          </div>
        ))}

        {run?.metrics && (
          <>
            <h3>分离质量（真值评测）</h3>
            <div className="metric-grid">
              <div className="metric">
                <div className={`v ${run.metrics.crossColor < 0.05 ? 'good' : 'bad'}`}>
                  {(run.metrics.crossColor * 100).toFixed(2)}%
                </div>
                <div className="k">综合串色率（阈值5%）</div>
              </div>
              <div className="metric">
                <div className="v">{(run.metrics.paperFalsePositive * 100).toFixed(2)}%</div>
                <div className="k">纸张误判率</div>
              </div>
              <div className="metric">
                <div className="v">{run.metrics.meanResidual.toFixed(3)}</div>
                <div className="k">平均残差 RMSE</div>
              </div>
              <div className="metric">
                <div className={`v ${run.elapsedMs < 3000 ? 'good' : 'bad'}`}>{run.elapsedMs.toFixed(0)}ms</div>
                <div className="k">GPU 全图耗时</div>
              </div>
            </div>
          </>
        )}
      </div>

      {showNewDoc && caseFile && (
        <NewDocumentDialog
          caseId={caseFile.id}
          onClose={() => setShowNewDoc(false)}
          onCreated={(id) => {
            setShowNewDoc(false);
            flash('新文书已创建，正在打开');
            window.location.hash = `#doc/${id}`;
          }}
        />
      )}

      {showReport && caseFile && (
        <div className="modal-mask" onClick={() => setShowReport(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>检验结论页</h2>
            <div className="form-field">
              <label>检验意见（将随图、指标、标注一起导出）</label>
              <textarea
                style={{ minHeight: 140 }}
                placeholder="例：经六波段反射率分离，金额处“拾”字及“（已收）”字样由第二种墨水（染料型黑色中性笔）书写，与原文颜料型签字笔墨水分层清晰，串色率低于5%，认定为后加笔画。"
                value={conclusion}
                onChange={(e) => setConclusion(e.target.value)}
              />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button onClick={() => setShowReport(false)}>取消</button>
              <button onClick={() => { exportReportJson({ caseFile, project, stageCanvas: canvasRef.current!, metrics: (run?.metrics as SeparationMetrics | null) ?? null, conclusion }); flash('JSON 检验记录已导出'); }}>
                导出 JSON
              </button>
              <button className="primary" onClick={doExportPng}>导出报告 PNG</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
