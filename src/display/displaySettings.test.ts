import { afterEach, describe, expect, it } from 'vitest';
import {
  applyDisplaySettings,
  initDisplaySettings,
  isTrustedParentMessage,
  requestedHandlerIsUi,
  sanitizeDisplaySettings,
  settingsFromGlobal,
  settingsFromQuery,
} from './displaySettings';

function freshRoot(): HTMLElement {
  const root = document.createElement('html');
  return root;
}

describe('sanitizeDisplaySettings', () => {
  it('accepts every whitelisted value', () => {
    expect(
      sanitizeDisplaySettings({ theme: 'light', uiStyle: 'fun', textSize: 'huge', accent: 'cyan' }),
    ).toEqual({ theme: 'light', uiStyle: 'fun', textSize: 'huge', accent: 'cyan' });
  });

  it('drops unknown values instead of passing them through', () => {
    expect(sanitizeDisplaySettings({ theme: 'oceanic', accent: 'hacker-green' })).toEqual({});
  });

  it('ignores non-object payloads entirely', () => {
    expect(sanitizeDisplaySettings('DISPLAY_SETTINGS_CHANGED')).toEqual({});
    expect(sanitizeDisplaySettings(null)).toEqual({});
    expect(sanitizeDisplaySettings(undefined)).toEqual({});
  });

  it('keeps only the fields that were actually valid, dropping the rest', () => {
    expect(sanitizeDisplaySettings({ theme: 'dark', accent: 'nonsense' })).toEqual({ theme: 'dark' });
  });
});

describe('settingsFromQuery', () => {
  it('parses whitelisted query params', () => {
    expect(settingsFromQuery('?theme=light&uiStyle=modern&textSize=extra-large&accent=blue')).toEqual({
      theme: 'light',
      uiStyle: 'modern',
      textSize: 'extra-large',
      accent: 'blue',
    });
  });

  it('ignores unrelated params and rejects invalid values', () => {
    expect(settingsFromQuery('?theme=oceanic&view=developers')).toEqual({});
  });
});

describe('settingsFromGlobal', () => {
  const globalWindow = window as unknown as Record<string, unknown>;
  afterEach(() => {
    delete globalWindow._qdnAccent;
    delete globalWindow._qdnTextSize;
    delete globalWindow._qdnTheme;
    delete globalWindow._qdnUiStyle;
    delete globalWindow._qdnUIStyle;
  });

  it('reads the individual Home globals', () => {
    globalWindow._qdnTheme = 'light';
    globalWindow._qdnAccent = 'clay';
    globalWindow._qdnTextSize = 'small';
    globalWindow._qdnUiStyle = 'modern';
    expect(settingsFromGlobal()).toEqual({ theme: 'light', uiStyle: 'modern', textSize: 'small', accent: 'clay' });
  });

  it('returns nothing when window._qdn is absent', () => {
    expect(settingsFromGlobal()).toEqual({});
  });
});

describe('applyDisplaySettings', () => {
  it('sets only the attributes present in settings, leaving the rest alone', () => {
    const root = freshRoot();
    root.setAttribute('data-accent', 'blue');
    applyDisplaySettings({ theme: 'light' }, root);
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.getAttribute('data-accent')).toBe('blue');
    expect(root.getAttribute('data-ui-style')).toBeNull();
  });
});

describe('isTrustedParentMessage', () => {
  it('rejects any message when this window has no embedding parent', () => {
    const event = { source: window } as unknown as MessageEvent;
    expect(isTrustedParentMessage(event)).toBe(false);
  });
});

describe('requestedHandlerIsUi', () => {
  it('accepts absent or UI handler and rejects other handlers', () => {
    expect(requestedHandlerIsUi({})).toBe(true);
    expect(requestedHandlerIsUi({ requestedHandler: 'UI' })).toBe(true);
    expect(requestedHandlerIsUi({ requestedHandler: 'settings' })).toBe(false);
  });
});

describe('initDisplaySettings (top-level, non-embedded window)', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('applies the initial query-string settings on init', () => {
    const globals = window as unknown as Record<string, unknown>;
    globals._qdnTheme = 'dark';
    window.history.replaceState(null, '', '/?theme=light&accent=clay');
    const root = freshRoot();
    const cleanup = initDisplaySettings(root);
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.getAttribute('data-accent')).toBe('clay');
    delete globals._qdnTheme;
    cleanup();
  });

  it('ignores a DISPLAY_SETTINGS_CHANGED message because there is no parent frame to trust', () => {
    const root = freshRoot();
    const cleanup = initDisplaySettings(root);
    window.dispatchEvent(
      new MessageEvent('message', { data: { action: 'DISPLAY_SETTINGS_CHANGED', settings: { theme: 'light' } } }),
    );
    expect(root.getAttribute('data-theme')).toBeNull();
    cleanup();
  });

  it('ignores messages with an unrelated action name', () => {
    const root = freshRoot();
    const cleanup = initDisplaySettings(root);
    window.dispatchEvent(new MessageEvent('message', { data: { action: 'SOMETHING_ELSE', theme: 'light' } }));
    expect(root.getAttribute('data-theme')).toBeNull();
    cleanup();
  });
});
