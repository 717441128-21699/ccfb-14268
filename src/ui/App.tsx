import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './AppContext';
import { CaseListPage } from './CaseListPage';
import { WorkspacePage } from './WorkspacePage';
import { NewDocumentDialog } from './NewDocumentDialog';

function Shell() {
  const { state } = useApp();
  const [route, setRoute] = useState(window.location.hash);
  const [newDocOpen, setNewDocOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const docMatch = route.match(/^#doc\/(.+)$/);
  const activeId = docMatch?.[1];
  const project = activeId ? state.projects.find((p) => p.id === activeId) : null;

  if (project) {
    return <WorkspacePage projectId={project.id} onBack={() => (window.location.hash = '')} />;
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo">墨<span>鉴</span> · 多波段文书检验工作站</div>
        <div className="sub">WebGL2 逐像素双墨水解混 ｜ 紫外/蓝光/红外六波段反射率分离</div>
        <div style={{ flex: 1 }} />
        <button className="primary" disabled={state.cases.length === 0} onClick={() => setNewDocOpen(true)}>
          新建检验文书
        </button>
      </div>
      <CaseListPage
        onOpenProject={(id) => {
          window.location.hash = `#doc/${id}`;
        }}
      />
      {newDocOpen && (
        <NewDocumentDialog
          caseId={state.cases[0]!.id}
          onClose={() => setNewDocOpen(false)}
          onCreated={(id) => {
            setNewDocOpen(false);
            window.location.hash = `#doc/${id}`;
          }}
        />
      )}
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
