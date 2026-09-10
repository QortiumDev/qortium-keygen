import { useEffect, useRef, useState } from 'react';
import { copyToClipboard } from './clipboard';

type Status = 'idle' | 'ok' | 'fail';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    };
  }, []);

  const onClick = async () => {
    const ok = await copyToClipboard(text);
    setStatus(ok ? 'ok' : 'fail');
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus('idle'), 2500);
  };

  return (
    <span className="copy">
      <button type="button" className="button small" onClick={() => void onClick()}>
        {label}
      </button>
      <span className="copy-status" role="status" aria-live="polite">
        {status === 'ok' && 'Copied to clipboard.'}
        {status === 'fail' && 'Copy failed — select the text manually.'}
      </span>
    </span>
  );
}
