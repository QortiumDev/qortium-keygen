// Workspace routing: a dependency-free query router. The canonical view is
// `?view=developers` (aliases: `developer`, `reference`). Reference sections
// use `?section=...`; the host fragment, unknown/repeated query entries, and
// the host's exact history.state are preserved. Generator state never enters
// the URL.

import { useCallback, useEffect, useState } from 'react';

export type WorkspaceView = 'generator' | 'developers';

const VIEW_ALIASES: Record<string, WorkspaceView> = {
  generator: 'generator',
  developers: 'developers',
  developer: 'developers',
  reference: 'developers',
};

export function parseView(search: string): WorkspaceView {
  const raw = new URLSearchParams(search).get('view');
  if (raw === null) return 'generator';
  return VIEW_ALIASES[raw.toLowerCase()] ?? 'generator';
}

export function parseSection(search: string): string {
  return new URLSearchParams(search).get('section') ?? '';
}

export interface UrlLike {
  pathname: string;
  search: string;
  hash: string;
}

export interface UrlOverrides {
  /** Set the canonical `view` query value ('generator' removes the key). */
  view?: WorkspaceView;
  /** Set the reference section query value; `''` removes it. */
  section?: string;
}

/** Rewrite only the known workspace keys. The hash is always preserved. */
export function buildWorkspaceUrl(current: UrlLike, overrides: UrlOverrides): string {
  const params = new URLSearchParams(current.search);
  if (overrides.view !== undefined) {
    if (overrides.view === 'generator') params.delete('view');
    else params.set('view', overrides.view);
  }
  if (overrides.section !== undefined) {
    if (overrides.section.length === 0) params.delete('section');
    else params.set('section', overrides.section);
  }
  const query = params.toString();
  return `${current.pathname}${query.length > 0 ? `?${query}` : ''}${current.hash}`;
}

function currentUrl(): UrlLike {
  return window.location;
}

function canonicalUrl(current: UrlLike): string {
  return buildWorkspaceUrl(current, { view: parseView(current.search) });
}

/** Push (or replace) while retaining the exact state owned by the embedding host. */
export function navigateToUrl(url: string, options: NavigateOptions = {}): void {
  const state = window.history.state;
  if (options.replace) window.history.replaceState(state, '', url);
  else window.history.pushState(state, '', url);
}

export interface NavigateOptions {
  replace?: boolean;
}

export interface WorkspaceRoute {
  view: WorkspaceView;
  section: string;
  hash: string;
  goToView(view: WorkspaceView, options?: NavigateOptions): void;
  goToSection(sectionId: string, options?: NavigateOptions): void;
  hrefForSection(sectionId: string): string;
}

function normalizeCurrentUrl(): void {
  const current = currentUrl();
  const url = canonicalUrl(current);
  const actual = `${current.pathname}${current.search}${current.hash}`;
  if (url !== actual) window.history.replaceState(window.history.state, '', url);
}

export function useWorkspaceRoute(): WorkspaceRoute {
  const [view, setView] = useState<WorkspaceView>(() => parseView(window.location.search));
  const [section, setSection] = useState<string>(() => parseSection(window.location.search));
  const [hash, setHash] = useState<string>(() => window.location.hash);

  useEffect(() => {
    const readRoute = () => {
      normalizeCurrentUrl();
      setView(parseView(window.location.search));
      setSection(parseSection(window.location.search));
      setHash(window.location.hash);
    };
    readRoute();
    window.addEventListener('popstate', readRoute);
    return () => window.removeEventListener('popstate', readRoute);
  }, []);

  const goToView = useCallback((nextView: WorkspaceView, options?: NavigateOptions) => {
    const url = buildWorkspaceUrl(currentUrl(), { view: nextView, ...(nextView === 'generator' ? { section: '' } : {}) });
    const actual = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (url !== actual) navigateToUrl(url, options);
    setView(nextView);
  }, []);

  const goToSection = useCallback((sectionId: string, options?: NavigateOptions) => {
    const url = buildWorkspaceUrl(currentUrl(), { view: 'developers', section: sectionId });
    const actual = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (url !== actual) navigateToUrl(url, options);
    setView('developers');
    setSection(sectionId);
  }, []);

  const hrefForSection = useCallback(
    (sectionId: string) => buildWorkspaceUrl(currentUrl(), { view: 'developers', section: sectionId }),
    [],
  );

  return { view, section, hash, goToView, goToSection, hrefForSection };
}
