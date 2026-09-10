import { GeneratorWorkspace } from './GeneratorWorkspace';
import { DevelopersWorkspace } from './DevelopersWorkspace';
import { useWorkspaceRoute } from './route';

export function App() {
  const route = useWorkspaceRoute();

  return (
    <div className="app">
      <header className="header">
        <h1>
          Qortium <span className="accent">Keygen</span>
        </h1>
        <p className="tagline">
          Search for a QORT address containing your chosen text — entirely in your browser, on both
          Qortium and Qortal.
        </p>
        <nav className="segmented workspace-nav" aria-label="Workspace">
          <button
            type="button"
            className={route.view === 'generator' ? 'segment active' : 'segment'}
            aria-current={route.view === 'generator' ? 'page' : undefined}
            onClick={() => route.goToView('generator')}
          >
            Generator
          </button>
          <button
            type="button"
            className={route.view === 'developers' ? 'segment active' : 'segment'}
            aria-current={route.view === 'developers' ? 'page' : undefined}
            onClick={() => route.goToView('developers')}
          >
            Developers
          </button>
        </nav>
      </header>

      {/* Both workspaces stay mounted at all times — hiding via the `hidden`
          attribute (not conditional rendering) so the Generator's running
          search, calibration state, hits, and any open reveal/password
          fields are never stopped, restarted, or cleared just by switching
          tabs, reference links, or browser back/forward. */}
      <div className="workspace-pane" hidden={route.view !== 'generator'}>
        <GeneratorWorkspace />
      </div>
      <div className="workspace-pane developers-pane" hidden={route.view !== 'developers'}>
        <DevelopersWorkspace
          section={route.section}
          onNavigateSection={route.goToSection}
          hrefForSection={route.hrefForSection}
        />
      </div>
    </div>
  );
}
