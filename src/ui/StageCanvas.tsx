import { useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Annotation, Roi } from '../core/types';

export type StageTool = 'select' | 'roi' | 'rect' | 'arrow' | 'text';

interface StageProps {
  width: number;
  height: number;
  rois: Roi[];
  selectedRoiId: string | null;
  annotations: Annotation[];
  tool: StageTool;
  onDrawRoi: (rect: { x0: number; y0: number; x1: number; y1: number }) => void;
  onAddAnnotation: (a: Annotation) => void;
  /** 文字工具落点后的内联输入回调（避免依赖 window.prompt） */
  pendingText: { x: number; y: number } | null;
  onCommitText: (text: string) => void;
  onCancelText: () => void;
  children: React.ReactNode;
}

/** 画布舞台：负责自适应缩放、ROI/标注的覆盖层绘制与指针交互（坐标全部归一化） */
export function StageCanvas(props: StageProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const drawing = useRef(false);

  const toNorm = (e: ReactPointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onDown = (e: ReactPointerEvent) => {
    if (props.tool === 'select') return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = toNorm(e);
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const onMove = (e: ReactPointerEvent) => {
    if (!drawing.current || !draft) return;
    const p = toNorm(e);
    setDraft({ ...draft, x1: p.x, y1: p.y });
  };

  const onUp = () => {
    if (!drawing.current || !draft) return;
    drawing.current = false;
    const w = Math.abs(draft.x1 - draft.x0);
    const h = Math.abs(draft.y1 - draft.y0);

    // 文字标注为单击落点，不要求拖出矩形
    if (props.tool === 'text') {
      props.onAddAnnotation({
        id: `an_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        kind: 'text',
        points: [{ x: draft.x0, y: draft.y0 }],
        text: '',
        color: '#fbbf24',
        createdAt: Date.now(),
      });
      setDraft(null);
      return;
    }

    if (w > 0.01 && h > 0.01) {
      if (props.tool === 'roi') props.onDrawRoi(draft);
      else if (props.tool === 'rect' || props.tool === 'arrow') {
        props.onAddAnnotation({
          id: `an_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          kind: props.tool,
          points: [
            { x: draft.x0, y: draft.y0 },
            { x: draft.x1, y: draft.y1 },
          ],
          text: '',
          color: '#fbbf24',
          createdAt: Date.now(),
        });
      }
    }
    setDraft(null);
  };

  return (
    <div className="stage-wrap" ref={wrapRef}>
      {props.children}
      <svg
        className={`overlay ${props.tool === 'select' ? '' : 'interactive'}`}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        {props.rois.map((r) => (
          <g key={r.id}>
            <rect
              x={Math.min(r.x0, r.x1)}
              y={Math.min(r.y0, r.y1)}
              width={Math.abs(r.x1 - r.x0)}
              height={Math.abs(r.y1 - r.y0)}
              fill={r.visible ? `${r.color}22` : 'transparent'}
              stroke={r.color}
              strokeWidth={r.id === props.selectedRoiId ? 0.004 : 0.002}
              vectorEffect="non-scaling-stroke"
              style={{ vectorEffect: 'non-scaling-stroke' }}
            />
            <text
              x={Math.min(r.x0, r.x1)}
              y={Math.max(0.012, Math.min(r.y0, r.y1) - 0.004)}
              fontSize={0.018}
              fill={r.color}
            >
              {r.name}
            </text>
          </g>
        ))}
        {props.annotations.map((a) => {
          if (a.kind === 'rect' && a.points.length === 2) {
            const [p0, p1] = a.points;
            return (
              <rect
                key={a.id}
                x={Math.min(p0!.x, p1!.x)}
                y={Math.min(p0!.y, p1!.y)}
                width={Math.abs(p1!.x - p0!.x)}
                height={Math.abs(p1!.y - p0!.y)}
                fill="none"
                stroke={a.color}
                strokeWidth={0.002}
              />
            );
          }
          if (a.kind === 'arrow' && a.points.length === 2) {
            const [p0, p1] = a.points;
            return (
              <line
                key={a.id}
                x1={p0!.x} y1={p0!.y} x2={p1!.x} y2={p1!.y}
                stroke={a.color}
                strokeWidth={0.0025}
                markerEnd="url(#arrowhead)"
              />
            );
          }
          if (a.kind === 'text' && a.points[0]) {
            return (
              <text key={a.id} x={a.points[0].x} y={a.points[0].y} fontSize={0.022} fill={a.color}>
                {a.text}
              </text>
            );
          }
          return null;
        })}
        {draft && (
          <rect
            x={Math.min(draft.x0, draft.x1)}
            y={Math.min(draft.y0, draft.y1)}
            width={Math.abs(draft.x1 - draft.x0)}
            height={Math.abs(draft.y1 - draft.y0)}
            fill="rgba(56,189,248,0.15)"
            stroke="#38bdf8"
            strokeWidth={0.002}
          />
        )}
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#fbbf24" />
          </marker>
        </defs>
      </svg>

      {props.pendingText && (
        <input
          autoFocus
          placeholder="输入标注文字，回车确认"
          className="text-annotation-input"
          style={{ left: `${props.pendingText.x * 100}%`, top: `${props.pendingText.y * 100}%` }}
          onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') props.onCommitText((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') props.onCancelText();
          }}
          onBlur={(e) => props.onCommitText(e.target.value)}
        />
      )}
    </div>
  );
}
