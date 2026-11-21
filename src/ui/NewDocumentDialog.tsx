import { useRef, useState } from 'react';
import type { DocProject, Endmember, Vec6, BandWeights } from '../core/types';
import { BANDS, BAND_COUNT } from '../core/bands';
import { getInk, inkAbsorbance } from '../core/spectra';
import { SYNTHETIC_SCENARIOS, generateSyntheticDoc } from '../core/synthetic';
import { createGray, type GrayImage } from '../core/raster';
import { uid } from '../core/util';
import { setBandImages } from '../state/bandStore';
import { setGroundTruth } from '../state/gtStore';
import { useApp } from './AppContext';

const DEFAULT_WEIGHTS: BandWeights = [1, 1, 1, 1, 1, 1];

function endmember(inkId: string, role: 1 | 2): Endmember {
  const ink = getInk(inkId);
  return {
    id: uid('em'),
    inkId,
    label: `${role === 1 ? '墨水一（原文）' : '墨水二（后加）'}：${ink.name}`,
    absorbance: [...inkAbsorbance(ink)] as Vec6,
    source: 'library',
  };
}

export function NewDocumentDialog({
  caseId,
  onClose,
  onCreated,
}: {
  caseId: string;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const { dispatch } = useApp();
  const [mode, setMode] = useState<'synthetic' | 'import'>('synthetic');
  const [scenarioId, setScenarioId] = useState(SYNTHETIC_SCENARIOS[0]!.id);
  const [size, setSize] = useState<'bench' | 'a4'>('bench');
  const [title, setTitle] = useState('');
  const [imported, setImported] = useState<GrayImage[] | null>(null);
  const [importName, setImportName] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  const createFromSynthetic = () => {
    setBusy(true);
    // 下一帧再跑，保证按钮状态先渲染
    requestAnimationFrame(() => {
      const scenario = SYNTHETIC_SCENARIOS.find((s) => s.id === scenarioId)!;
      const dims = size === 'a4'
        ? { width: 1654, height: 2339 } // A4 @200DPI，性能验收尺寸
        : { width: 794, height: 1123 };
      const doc = generateSyntheticDoc(scenario, dims);
      const id = uid('doc');
      const project: DocProject = {
        id,
        caseId,
        title: title || `${scenario.name}·合成样本`,
        width: doc.width,
        height: doc.height,
        bandImageIds: BANDS.map((b) => `${id}:${b.id}`),
        offsets: BANDS.map(() => ({ dx: 0, dy: 0 })),
        endmember1: endmember(scenario.ink1Id, 1),
        endmember2: endmember(scenario.ink2Id, 2),
        rois: [],
        annotations: [],
        displayMode: 'split',
        globalWeights: [...DEFAULT_WEIGHTS],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setBandImages(id, doc.bands);
      setGroundTruth(id, doc.groundTruth);
      dispatch({ type: 'upsertProject', project });
      onCreated(id);
    });
  };

  const loadBandFile = (bandIdx: number, file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const gray = createGray(canvas.width, canvas.height);
      for (let i = 0; i < gray.data.length; i++) {
        gray.data[i] =
          (rgba.data[i * 4]! * 0.299 + rgba.data[i * 4 + 1]! * 0.587 + rgba.data[i * 4 + 2]! * 0.114) / 255;
      }
      const next = imported ? [...imported] : Array.from({ length: BAND_COUNT }, () => null as GrayImage | null);
      next[bandIdx] = gray;
      if (next.every((b) => b !== null)) setImported(next as GrayImage[]);
      else setImported(next as unknown as GrayImage[]);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const createFromImport = () => {
    if (!imported || imported.some((b) => !b)) {
      alert('请先为六个波段各导入一张照片');
      return;
    }
    const w = imported[0]!.width;
    const h = imported[0]!.height;
    if (!imported.every((b) => b.width === w && b.height === h)) {
      alert('六张照片尺寸不一致，请先在文检仪软件中配准导出');
      return;
    }
    const id = uid('doc');
    const project: DocProject = {
      id,
      caseId,
      title: title || importName || '导入文书',
      width: w,
      height: h,
      bandImageIds: BANDS.map((b) => `${id}:${b.id}`),
      offsets: BANDS.map(() => ({ dx: 0, dy: 0 })),
      endmember1: endmember('black-sign-pigment', 1),
      endmember2: endmember('black-gel-dye', 2),
      rois: [],
      annotations: [],
      displayMode: 'split',
      globalWeights: [...DEFAULT_WEIGHTS],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setBandImages(id, imported);
    dispatch({ type: 'upsertProject', project });
    onCreated(id);
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>新建检验文书</h2>
        <div className="row" style={{ marginBottom: 14 }}>
          <button className={mode === 'synthetic' ? 'primary' : ''} onClick={() => setMode('synthetic')}>合成测试样本</button>
          <button className={mode === 'import' ? 'primary' : ''} onClick={() => setMode('import')}>导入六波段照片</button>
        </div>

        <div className="form-field">
          <label>文书名称（留空自动命名）</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：借款合同原件第1页" />
        </div>

        {mode === 'synthetic' ? (
          <>
            <div className="form-field">
              <label>检验场景（按墨水光谱反射曲线与纸张纹理合成，带真值掩膜）</label>
              {SYNTHETIC_SCENARIOS.map((s) => (
                <div key={s.id} className="roi-item" style={{ cursor: 'pointer' }}
                  onClick={() => setScenarioId(s.id)}>
                  <div className="roi-head">
                    <input type="radio" checked={scenarioId === s.id} readOnly style={{ width: 'auto' }} />
                    <strong>{s.name}</strong>
                  </div>
                  <div className="muted">{s.description}</div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    墨水一：{getInk(s.ink1Id).name}　|　墨水二：{getInk(s.ink2Id).name}
                  </div>
                </div>
              ))}
            </div>
            <div className="form-field">
              <label>画布尺寸</label>
              <select value={size} onChange={(e) => setSize(e.target.value as 'bench' | 'a4')}>
                <option value="bench">工作台尺寸 794×1123（流畅）</option>
                <option value="a4">A4 @200DPI 1654×2339（性能验收口径）</option>
              </select>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button onClick={onClose}>取消</button>
              <button className="primary" disabled={busy} onClick={createFromSynthetic}>生成并进入检验</button>
            </div>
          </>
        ) : (
          <>
            <div className="muted" style={{ marginBottom: 10 }}>
              文书压在文检仪玻璃下保持不动，按六个波段各拍一张，依次导入。照片需同尺寸、已配准。
            </div>
            <div className="grid2">
              {BANDS.map((b, i) => (
                <div key={b.id} className="form-field">
                  <label style={{ color: b.color }}>{b.name}</label>
                  <input
                    ref={(el) => { fileRefs.current[i] = el; }}
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setImportName(f.name);
                        loadBandFile(i, f);
                      }
                    }}
                  />
                  {imported?.[i] && <span className="tag good" style={{ marginTop: 4, display: 'inline-block' }}>✓ 已载入</span>}
                </div>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button onClick={onClose}>取消</button>
              <button className="primary" onClick={createFromImport}>导入并进入检验</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
