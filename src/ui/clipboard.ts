// Clipboard write with an accessible fallback for hosts that block
// `navigator.clipboard` (insecure/plain-HTTP QDN gateways, some WebViews):
// falls back to a hidden `<textarea>` + `execCommand('copy')`. Returns
// whether the copy actually succeeded so callers can report success/failure
// truthfully instead of assuming a click always works.

export async function copyToClipboard(text: string): Promise<boolean> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (clipboard?.writeText !== undefined) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy fallback below.
    }
  }
  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}
