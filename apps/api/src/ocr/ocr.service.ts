import { Injectable } from '@nestjs/common';
import { encrypt, maskAadhaar } from '../common/utils/encryption.util';

export interface AadhaarOcrResult {
  firstName?: string;
  lastName?: string;
  aadhaarMasked?: string;
  aadhaarEncrypted?: string;
  address?: string;
  dateOfBirth?: string;
  rawText: string;
}

@Injectable()
export class OcrService {
  async extractAadhaar(buffer: Buffer): Promise<AadhaarOcrResult> {
    // Lazy so the ~63MB tesseract WASM tree never loads at boot — only when a
    // hotel actually scans an ID (a rare path on most deployments).
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    try {
      const { data } = await worker.recognize(buffer);
      const text = data.text;
      return this.parseAadhaarText(text);
    } finally {
      await worker.terminate();
    }
  }

  parseAadhaarText(text: string): AadhaarOcrResult {
    const aadhaarMatch = text.replace(/\s/g, '').match(/\d{4}\d{4}\d{4}/);
    const aadhaar = aadhaarMatch ? aadhaarMatch[0] : undefined;

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const nameLine = lines.find((l) => /^[A-Za-z\s]{3,}$/.test(l) && !l.includes('Government'));

    let firstName = '';
    let lastName = '';
    if (nameLine) {
      const parts = nameLine.split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }

    const dobMatch = text.match(/\d{2}[/-]\d{2}[/-]\d{4}/);

    return {
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      address: lines.slice(2, 5).join(', ') || undefined,
      dateOfBirth: dobMatch?.[0],
      aadhaarMasked: aadhaar ? maskAadhaar(aadhaar) : undefined,
      aadhaarEncrypted: aadhaar ? encrypt(aadhaar) : undefined,
      rawText: text,
    };
  }
}
