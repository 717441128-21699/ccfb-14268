/** 应用全局状态（React reducer + localStorage 持久化，波段图像仅驻内存） */
import type { CaseFile, DocProject } from '../core/types';
import { uid } from '../core/util';

const STORAGE_KEY = 'mojian.state.v1';

export interface AppState {
  cases: CaseFile[];
  projects: DocProject[];
  activeProjectId: string | null;
}

export type AppAction =
  | { type: 'createCase'; caseFile: CaseFile }
  | { type: 'updateCase'; caseFile: CaseFile }
  | { type: 'deleteCase'; id: string }
  | { type: 'upsertProject'; project: DocProject }
  | { type: 'patchProject'; id: string; patch: Partial<DocProject> }
  | { type: 'deleteProject'; id: string }
  | { type: 'openProject'; id: string | null }
  | { type: 'reset' };

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'createCase':
      return { ...state, cases: [action.caseFile, ...state.cases] };
    case 'updateCase':
      return {
        ...state,
        cases: state.cases.map((c) => (c.id === action.caseFile.id ? action.caseFile : c)),
      };
    case 'deleteCase':
      return {
        ...state,
        cases: state.cases.filter((c) => c.id !== action.id),
        projects: state.projects.filter((p) => p.caseId !== action.id),
      };
    case 'upsertProject': {
      const exists = state.projects.some((p) => p.id === action.project.id);
      return {
        ...state,
        projects: exists
          ? state.projects.map((p) => (p.id === action.project.id ? action.project : p))
          : [action.project, ...state.projects],
        activeProjectId: action.project.id,
      };
    }
    case 'patchProject':
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.id ? { ...p, ...action.patch, updatedAt: Date.now() } : p,
        ),
      };
    case 'deleteProject':
      return {
        ...state,
        projects: state.projects.filter((p) => p.id !== action.id),
        activeProjectId: state.activeProjectId === action.id ? null : state.activeProjectId,
      };
    case 'openProject':
      return { ...state, activeProjectId: action.id };
    case 'reset':
      return { cases: [], projects: [], activeProjectId: null };
    default:
      return state;
  }
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      // 运行时图像字段不持久化
      return { ...parsed, activeProjectId: null };
    }
  } catch {
    /* 忽略损坏的存档 */
  }
  return { cases: [], projects: [], activeProjectId: null };
}

export function persistState(state: AppState): void {
  try {
    const storable = {
      cases: state.cases,
      projects: state.projects.map((p) => ({ ...p })),
      activeProjectId: null,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storable));
  } catch {
    /* 配额不足时静默降级 */
  }
}

export function newCase(input: Partial<CaseFile>): CaseFile {
  const now = Date.now();
  return {
    id: uid('case'),
    caseNo: input.caseNo ?? `案字〔${new Date().getFullYear()}〕第${Math.floor(Math.random() * 900 + 100)}号`,
    title: input.title ?? '未命名案件',
    examiner: input.examiner ?? '',
    notes: input.notes ?? '',
    createdAt: now,
    updatedAt: now,
  };
}
