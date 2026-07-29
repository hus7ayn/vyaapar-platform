import { toast } from 'sonner';

/**
 * Print an HTML document reliably from anywhere in the app — including code paths that run AFTER
 * an `await` (fetching a barcode image or a receipt before printing).
 *
 * We deliberately do NOT use `window.open()`: a popup needs a live user-activation gesture, and
 * every real print path here calls this after at least one awaited fetch, so the gesture is already
 * spent and the popup is blocked → nothing prints (the exact "works on other sites but not ours"
 * bug). A hidden same-origin IFRAME needs no gesture, is never popup-blocked, and
 * `iframe.contentWindow.print()` prints ONLY the iframe's own document (with its own @page label
 * size) — not the parent app. This is the pattern MDN, react-to-print and print-js all use.
 *
 * Returns true once the print view is created and the dialog is invoked.
 */
export function printHtmlDocument(content: string): boolean {
  try {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    // Off-screen but RENDERED — never display:none (some engines then print a blank page).
    // No `sandbox` attribute → same-origin, so print()/modals are allowed.
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const doc = win?.document;
    if (!win || !doc) {
      iframe.remove();
      toast.error('Failed to open print view');
      return false;
    }

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      // Delay removal — Firefox cancels/hangs an in-flight print if the iframe is yanked at once.
      setTimeout(() => { try { iframe.remove(); } catch { /* already gone */ } }, 1000);
    };
    win.onafterprint = cleanup;

    let printed = false;
    const go = () => {
      if (printed) return;
      printed = true;
      // focus() before print() is required by Safari and harmless elsewhere. Firefox can throw a
      // benign DOMException mentioning onafterprint around focus/print — swallow it.
      try { win.focus(); win.print(); } catch { /* benign */ }
      setTimeout(cleanup, 60_000); // fallback if onafterprint never fires
    };

    // Synchronous write guarantees the DOM exists before we inspect its images.
    doc.open();
    doc.write(content);
    doc.close();

    const start = () => {
      const pending = Array.from(doc.images || []).filter((i) => !i.complete);
      if (pending.length === 0) { setTimeout(go, 50); return; }
      let left = pending.length;
      const tick = () => { if (--left <= 0) go(); };
      pending.forEach((i) => { i.addEventListener('load', tick); i.addEventListener('error', tick); });
      setTimeout(go, 2000); // print anyway if a decode/load event is lost
    };

    if (doc.readyState === 'complete') start();
    else win.addEventListener('load', start, { once: true });

    return true;
  } catch {
    toast.error('Failed to print');
    return false;
  }
}
