import { useState } from 'react';
import { useApp } from './AppContext';
import { newCase } from '../state/store';
import type { CaseFile } from '../core/types';
import { uid } from '../core/util';

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

export function CaseListPage({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const { state, dispatch } = useApp();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ caseNo: '', title: '', examiner: '', notes: '' });
  const [expandedCase, setExpandedCase] = useState<string | null>(null);

  const createCase = () => {
    const c = newCase({
      caseNo: form.caseNo || undefined,
      title: form.title || undefined,
      examiner: form.examiner,
      notes: form.notes,
    });
    dispatch({ type: 'createCase', caseFile: c });
    setForm({ caseNo: '', title: '', examiner: '', notes: '' });
    setCreating(false);
    setExpandedCase(c.id);
  };

  const projectCount = (caseId: string) => state.projects.filter((p) => p.caseId === caseId).length;

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>案件列表</h2>
            <button className="primary" onClick={() => setCreating(true)}>＋ 新建案件</button>
          </div>
        </div>

        {state.cases.length === 0 && (
          <div className="card muted">
            暂无案件。点击「新建案件」建档，或在案件内新建检验文书（支持导入六波段照片、生成合成测试样本）。
          </div>
        )}

        {state.cases.map((c: CaseFile) => (
          <div className="card" key={c.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong style={{ fontSize: 15 }}>{c.title}</strong>
                <span className="tag" style={{ marginLeft: 10 }}>{c.caseNo}</span>
                <div className="muted" style={{ marginTop: 4 }}>
                  检验员：{c.examiner || '—'}　·　文书 {projectCount(c.id)} 份　·　更新于 {fmtTime(c.updatedAt)}
                </div>
                {c.notes && <div className="muted" style={{ marginTop: 6 }}>备注：{c.notes}</div>}
              </div>
              <div className="row">
                <button onClick={() => setExpandedCase(expandedCase === c.id ? null : c.id)}>
                  {expandedCase === c.id ? '收起文书' : `查看文书 (${projectCount(c.id)})`}
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    if (confirm(`删除案件「${c.title}」及其全部文书？`)) dispatch({ type: 'deleteCase', id: c.id });
                  }}
                >
                  删除
                </button>
              </div>
            </div>

            {expandedCase === c.id && (
              <table className="table" style={{ marginTop: 12 }}>
                <thead>
                  <tr><th>文书名称</th><th>尺寸</th><th>更新时间</th><th></th></tr>
                </thead>
                <tbody>
                  {state.projects.filter((p) => p.caseId === c.id).map((p) => (
                    <tr key={p.id}>
                      <td>{p.title}</td>
                      <td>{p.width} × {p.height}</td>
                      <td>{fmtTime(p.updatedAt)}</td>
                      <td>
                        <button className="primary" onClick={() => onOpenProject(p.id)}>打开检验</button>
                        <button
                          className="danger"
                          style={{ marginLeft: 8 }}
                          onClick={() => {
                            if (confirm(`删除文书「${p.title}」？`)) dispatch({ type: 'deleteProject', id: p.id });
                          }}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                  {projectCount(c.id) === 0 && (
                    <tr><td colSpan={4} className="muted">该案件下尚无文书，请在检验工作台中新建。</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        ))}

        {creating && (
          <div className="modal-mask" onClick={() => setCreating(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>新建案件</h2>
              <div className="form-field">
                <label>案件编号</label>
                <input placeholder="留空自动生成" value={form.caseNo}
                  onChange={(e) => setForm({ ...form, caseNo: e.target.value })} />
              </div>
              <div className="form-field">
                <label>案件名称</label>
                <input placeholder="如：张某借款合同涂改案" value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="form-field">
                <label>检验员</label>
                <input value={form.examiner}
                  onChange={(e) => setForm({ ...form, examiner: e.target.value })} />
              </div>
              <div className="form-field">
                <label>备注</label>
                <textarea value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button onClick={() => setCreating(false)}>取消</button>
                <button className="primary" onClick={createCase}>建档</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function newProjectId(): string {
  return uid('doc');
}
