/* QuaggaJS loaded from CDN to avoid Node/sharp bundling in Next.js */

export interface QuaggaResult {
  codeResult?: { code?: string };
}

export interface QuaggaStatic {
  init(config: Record<string, unknown>, cb: (err?: Error | string) => void): void;
  start(): void;
  stop(): void;
  onDetected(cb: (result: QuaggaResult) => void): void;
  offDetected(cb: (result: QuaggaResult) => void): void;
}

declare global {
  interface Window {
    Quagga?: QuaggaStatic;
  }
}

const QUAGGA_CDN =
  'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.8.4/dist/quagga.min.js';

export function loadQuagga(): Promise<QuaggaStatic> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('QuaggaJS requires browser'));
  }
  if (window.Quagga) return Promise.resolve(window.Quagga);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${QUAGGA_CDN}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Quagga!));
      existing.addEventListener('error', () => reject(new Error('QuaggaJS load failed')));
      return;
    }
    const script = document.createElement('script');
    script.src = QUAGGA_CDN;
    script.async = true;
    script.onload = () => {
      if (window.Quagga) resolve(window.Quagga);
      else reject(new Error('QuaggaJS not available'));
    };
    script.onerror = () => reject(new Error('QuaggaJS load failed'));
    document.head.appendChild(script);
  });
}
