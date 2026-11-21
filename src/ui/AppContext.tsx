import { useReducer, useEffect, createContext, useContext, type Dispatch } from 'react';
import { loadState, persistState, reducer, type AppAction, type AppState } from '../state/store';

const Ctx = createContext<{ state: AppState; dispatch: Dispatch<AppAction> } | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  useEffect(() => persistState(state), [state]);
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export function useApp(): { state: AppState; dispatch: Dispatch<AppAction> } {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider 缺失');
  return v;
}
