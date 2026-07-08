import { useEffect, useRef } from 'react';

const MAX_INTERVAL_MS = 50; // USB/BT keyboard-wedge scanners send keys far faster than a human types
const MIN_LENGTH = 3;

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Captures USB/Bluetooth barcode scanners (keyboard-wedge devices) even when no
 * input has focus, by distinguishing scanner-speed keystroke bursts from human
 * typing via inter-keystroke timing. When an editable field IS focused, this is
 * a no-op — that field's own Enter handler already covers scans typed into it.
 */
export function useBarcodeWedge(onScan: (code: string) => void, enabled = true) {
  const bufferRef = useRef('');
  const bufferStartRef = useRef(0);
  const lastKeyTimeRef = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      const now = performance.now();
      const elapsed = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === 'Enter') {
        const code = bufferRef.current;
        const totalElapsed = now - bufferStartRef.current;
        bufferRef.current = '';
        if (code.length >= MIN_LENGTH && totalElapsed <= code.length * MAX_INTERVAL_MS) {
          e.preventDefault();
          onScanRef.current(code);
        }
        return;
      }

      if (e.key.length !== 1) return; // ignore Shift/Tab/arrows/function keys etc.

      if (elapsed > MAX_INTERVAL_MS) {
        bufferRef.current = e.key;
        bufferStartRef.current = now;
      } else {
        bufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}
