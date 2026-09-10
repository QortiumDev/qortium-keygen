import { afterEach, describe, expect, it } from 'vitest';
import { buildWorkspaceUrl, navigateToUrl, parseSection, parseView } from './route';

describe('parseView and parseSection', () => {
  it('recognizes canonical and legacy developer aliases', () => {
    expect(parseView('')).toBe('generator');
    expect(parseView('?view=developers')).toBe('developers');
    expect(parseView('?view=developer')).toBe('developers');
    expect(parseView('?view=reference')).toBe('developers');
    expect(parseSection('?view=developers&section=hub-backup-schema')).toBe('hub-backup-schema');
  });

  it('falls back to generator for an unrecognized view', () => {
    expect(parseView('?view=nonsense')).toBe('generator');
  });
});

describe('buildWorkspaceUrl', () => {
  it('preserves unrelated and repeated query keys and the host fragment', () => {
    expect(buildWorkspaceUrl(
      { pathname: '/', search: '?utm=abc&tag=1&tag=2&view=developer', hash: '#host-fragment' },
      { view: 'developers', section: 'hub-backup-schema' },
    )).toBe('/?utm=abc&tag=1&tag=2&view=developers&section=hub-backup-schema#host-fragment');
  });

  it('removes workspace keys for the default generator view while retaining all host keys', () => {
    expect(buildWorkspaceUrl(
      { pathname: '/', search: '?view=developers&section=x&utm=abc', hash: '#keep' },
      { view: 'generator', section: '' },
    )).toBe('/?utm=abc#keep');
  });

  it('does not place generator secrets into newly generated URL state', () => {
    expect(buildWorkspaceUrl(
      { pathname: '/', search: '?pattern=abc&seedHex=deadbeef', hash: '' },
      { view: 'developers' },
    )).toContain('pattern=abc&seedHex=deadbeef');
  });
});

describe('navigateToUrl', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it.each([
    ['object', { hostFlag: true }],
    ['null', null],
    ['scalar', 'host-state'],
  ])('preserves exact %s history.state', (_label, state) => {
    window.history.replaceState(state, '', '/');
    navigateToUrl('/?view=developers');
    expect(window.history.state).toBe(state);
  });

  it('replaces instead of pushing when requested', () => {
    const before = window.history.length;
    navigateToUrl('/?view=developers', { replace: true });
    expect(window.history.length).toBe(before);
  });
});
