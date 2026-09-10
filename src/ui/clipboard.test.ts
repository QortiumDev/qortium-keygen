import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './clipboard';

const originalClipboard = navigator.clipboard;
const originalExecCommand = document.execCommand;

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  document.execCommand = originalExecCommand;
  vi.restoreAllMocks();
});

describe('copyToClipboard', () => {
  it('uses navigator.clipboard.writeText when available and succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const ok = await copyToClipboard('hello');

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when navigator.clipboard.writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked by CSP'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(true);

    const ok = await copyToClipboard('hello');

    expect(ok).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when navigator.clipboard is entirely absent', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(true);

    const ok = await copyToClipboard('hello');

    expect(ok).toBe(true);
  });

  it('reports failure honestly when every path fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false);

    const ok = await copyToClipboard('hello');

    expect(ok).toBe(false);
  });

  it('does not leak the scratch textarea into the document', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(true);

    await copyToClipboard('hello');

    expect(document.querySelector('textarea')).toBeNull();
  });
});
