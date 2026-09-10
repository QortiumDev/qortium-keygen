// Home fleet appearance sync. This module only applies whitelisted visual
// attributes; it never handles keys, search state, storage, or language.

export type Theme = 'dark' | 'light';
export type UiStyle = 'classic' | 'modern' | 'fun';
export type TextSize = 'extra-small' | 'small' | 'medium' | 'large' | 'extra-large' | 'huge';
export type Accent = 'green' | 'blue' | 'orange' | 'purple' | 'red' | 'teal' | 'cyan' | 'pink' | 'yellow' | 'clay';

export interface DisplaySettings {
  theme?: Theme;
  uiStyle?: UiStyle;
  textSize?: TextSize;
  accent?: Accent;
}

const THEMES: readonly Theme[] = ['dark', 'light'];
const UI_STYLES: readonly UiStyle[] = ['classic', 'modern', 'fun'];
const TEXT_SIZES: readonly TextSize[] = ['extra-small', 'small', 'medium', 'large', 'extra-large', 'huge'];
const ACCENTS: readonly Accent[] = ['green', 'blue', 'orange', 'purple', 'red', 'teal', 'cyan', 'pink', 'yellow', 'clay'];
const DISPLAY_SETTINGS_CHANGED = 'DISPLAY_SETTINGS_CHANGED';

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : undefined;
}

/** Whitelist an arbitrary payload down to the four known, safe fields. */
export function sanitizeDisplaySettings(raw: unknown): DisplaySettings {
  if (typeof raw !== 'object' || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const settings: DisplaySettings = {};
  const theme = pick(source.theme, THEMES);
  const uiStyle = pick(source.uiStyle ?? source['ui-style'], UI_STYLES);
  const textSize = pick(source.textSize ?? source['text-size'], TEXT_SIZES);
  const accent = pick(source.accent, ACCENTS);
  if (theme !== undefined) settings.theme = theme;
  if (uiStyle !== undefined) settings.uiStyle = uiStyle;
  if (textSize !== undefined) settings.textSize = textSize;
  if (accent !== undefined) settings.accent = accent;
  return settings;
}

/** Query parameters are accepted in camelCase and kebab-case spellings. */
export function settingsFromQuery(search: string): DisplaySettings {
  const params = new URLSearchParams(search);
  return sanitizeDisplaySettings({
    uiStyle: params.get('uiStyle') ?? params.get('ui-style') ?? params.get('qdnUiStyle') ?? params.get('qdnUIStyle'),
    textSize: params.get('textSize') ?? params.get('text-size') ?? params.get('qdnTextSize'),
    accent: params.get('accent') ?? params.get('qdnAccent'),
    theme: params.get('theme') ?? params.get('qdnTheme'),
  });
}

/** Home exposes these individual globals before loading a QDN app bundle. */
export function settingsFromGlobal(): DisplaySettings {
  if (typeof window === 'undefined') return {};
  const host = window as unknown as {
    _qdnAccent?: unknown;
    _qdnTextSize?: unknown;
    _qdnTheme?: unknown;
    _qdnUiStyle?: unknown;
    _qdnUIStyle?: unknown;
  };
  return sanitizeDisplaySettings({
    accent: host._qdnAccent,
    textSize: host._qdnTextSize,
    theme: host._qdnTheme,
    uiStyle: host._qdnUiStyle ?? host._qdnUIStyle,
  });
}

/** Only overrides attributes present in `settings`; other attributes survive. */
export function applyDisplaySettings(settings: DisplaySettings, root: HTMLElement = document.documentElement): void {
  if (settings.theme !== undefined) root.setAttribute('data-theme', settings.theme);
  if (settings.uiStyle !== undefined) root.setAttribute('data-ui-style', settings.uiStyle);
  if (settings.textSize !== undefined) root.setAttribute('data-text-size', settings.textSize);
  if (settings.accent !== undefined) root.setAttribute('data-accent', settings.accent);
}

function readAction(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const action = (data as Record<string, unknown>).action;
  return typeof action === 'string' ? action : undefined;
}

function readSettingsPayload(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as Record<string, unknown>;
  return 'settings' in record ? record.settings : data;
}

function settingsFromMessage(data: unknown): DisplaySettings {
  if (typeof data !== 'object' || data === null) return {};
  const record = data as Record<string, unknown>;
  const payload = readSettingsPayload(data);
  const source = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
  switch (record.action) {
    case 'THEME_CHANGED': return sanitizeDisplaySettings({ theme: source.theme ?? source.qdnTheme });
    case 'ACCENT_CHANGED': return sanitizeDisplaySettings({ accent: source.accent ?? source.qdnAccent });
    case 'TEXT_SIZE_CHANGED': return sanitizeDisplaySettings({ textSize: source.textSize ?? source.qdnTextSize });
    case 'UI_STYLE_CHANGED': return sanitizeDisplaySettings({ uiStyle: source.uiStyle ?? source.ui ?? source.qdnUiStyle ?? source.qdnUIStyle });
    case DISPLAY_SETTINGS_CHANGED: return sanitizeDisplaySettings(payload);
    default: return {};
  }
}

/** Parent/source validation follows the Home message contract. */
export function isTrustedParentMessage(event: MessageEvent): boolean {
  if (typeof window === 'undefined' || window.parent === window) return false;
  return event.source == null || event.source === window.parent;
}

export function requestedHandlerIsUi(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return true;
  const handler = (data as Record<string, unknown>).requestedHandler;
  return handler === undefined || handler === 'UI' || handler === 'ui';
}

/** Wires up query-over-global initial paint and parent-only live updates. */
export function initDisplaySettings(root: HTMLElement = document.documentElement): () => void {
  applyDisplaySettings(settingsFromGlobal(), root);
  applyDisplaySettings(settingsFromQuery(window.location.search), root);

  const onMessage = (event: MessageEvent) => {
    const action = readAction(event.data);
    if (action !== DISPLAY_SETTINGS_CHANGED && action !== 'THEME_CHANGED' && action !== 'ACCENT_CHANGED' && action !== 'TEXT_SIZE_CHANGED' && action !== 'UI_STYLE_CHANGED') return;
    if (!requestedHandlerIsUi(event.data) || !isTrustedParentMessage(event)) return;
    applyDisplaySettings(settingsFromMessage(event.data), root);
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
