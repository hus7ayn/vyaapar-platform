'use client';

import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { loadQuagga, type QuaggaResult } from '@/lib/quagga-loader';
import { Button } from '@/components/ui/button';
import { X, Camera } from 'lucide-react';

export type ScannerEngine = 'zxing' | 'quagga';

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
  defaultEngine?: ScannerEngine;
}

export function BarcodeScanner({ onScan, onClose, defaultEngine = 'zxing' }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const quaggaRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [engine, setEngine] = useState<ScannerEngine>(defaultEngine);

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;

    const runZxing = async () => {
      const reader = new BrowserMultiFormatReader();
      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        const deviceId = devices[0]?.deviceId;
        if (!deviceId || !videoRef.current) return;

        await reader.decodeFromVideoDevice(deviceId, videoRef.current, (result) => {
          if (result && active) {
            onScan(result.getText());
            active = false;
            onClose();
          }
        });
        cleanup = () => undefined;
      } catch {
        setError('Camera access denied or unavailable');
      }
    };

    const runQuagga = async () => {
      try {
        const Quagga = await loadQuagga();
        if (!quaggaRef.current) return;

        await new Promise<void>((resolve, reject) => {
          Quagga.init(
            {
              inputStream: {
                type: 'LiveStream',
                target: quaggaRef.current!,
                constraints: { facingMode: 'environment' },
              },
              locator: { patchSize: 'medium', halfSample: true },
              numOfWorkers: 0,
              decoder: {
                readers: [
                  'ean_reader',
                  'ean_8_reader',
                  'code_128_reader',
                  'code_39_reader',
                  'upc_reader',
                  'upc_e_reader',
                ],
              },
              locate: true,
            },
            (err) => (err ? reject(err) : resolve()),
          );
        });

        Quagga.start();
        const onDetected = (result: QuaggaResult) => {
          const code = result.codeResult?.code;
          if (code && active) {
            onScan(code);
            active = false;
            Quagga.stop();
            onClose();
          }
        };
        Quagga.onDetected(onDetected);
        cleanup = () => {
          Quagga.offDetected(onDetected);
          Quagga.stop();
        };
      } catch {
        setError('QuaggaJS could not start — try ZXing mode');
      }
    };

    setError('');
    if (engine === 'quagga') runQuagga();
    else runZxing();

    return () => {
      active = false;
      cleanup?.();
    };
  }, [engine, onScan, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl overflow-hidden max-w-lg w-full">
        <div className="flex justify-between items-center p-4 border-b">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            <span className="font-semibold">Scan Barcode</span>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex gap-2 p-3 border-b bg-muted/30">
          <Button
            size="sm"
            variant={engine === 'zxing' ? 'default' : 'outline'}
            onClick={() => setEngine('zxing')}
          >
            ZXing
          </Button>
          <Button
            size="sm"
            variant={engine === 'quagga' ? 'default' : 'outline'}
            onClick={() => setEngine('quagga')}
          >
            QuaggaJS
          </Button>
        </div>
        <div
          ref={quaggaRef}
          className={engine === 'quagga' ? 'w-full aspect-video bg-black overflow-hidden' : 'hidden'}
        />
        <video
          ref={videoRef}
          className={engine === 'zxing' ? 'w-full aspect-video bg-black' : 'hidden'}
          playsInline
          muted
        />
        {error && <p className="p-4 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
