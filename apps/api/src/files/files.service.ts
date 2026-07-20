import { Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

type StorageDriver = 'disk' | 's3' | 'vercel-blob';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

/**
 * File storage with a zero-infrastructure default: STORAGE_DRIVER=disk (default)
 * writes uploads to a local folder served back via a signed route, so no MinIO/S3
 * daemon is required. Set STORAGE_DRIVER=s3 to keep the old object-storage behavior
 * (the AWS SDK is only imported in that mode), or STORAGE_DRIVER=vercel-blob when
 * running as a Vercel serverless function, since the local disk isn't writable
 * across invocations there.
 */
@Injectable()
export class FilesService {
  private driver: StorageDriver =
    process.env.STORAGE_DRIVER === 's3'
      ? 's3'
      : process.env.STORAGE_DRIVER === 'vercel-blob'
        ? 'vercel-blob'
        : 'disk';
  private uploadsDir = process.env.UPLOADS_DIR || path.resolve(process.cwd(), 'uploads');
  // Absolute base of THIS API (uploads are served by the API, not the web app),
  // so stored URLs resolve regardless of which origin renders them.
  private apiBaseUrl = (process.env.API_PUBLIC_URL || 'http://localhost:4000').replace(/\/+$/, '');
  private urlSecret = process.env.FILE_URL_SECRET || process.env.JWT_SECRET || 'dev-secret';
  private bucket = process.env.S3_BUCKET || 'nexus-uploads';

  // ─── S3 (lazy — only touched when STORAGE_DRIVER=s3) ─────────────────────────
  private s3Client: unknown;

  constructor() {
    // Fail fast on Vercel: the 'disk' driver writes to a read-only, non-persistent
    // filesystem there, so uploads would silently error at request time. Force an
    // explicit object-storage driver instead of leaking a confusing runtime EROFS.
    if (this.driver === 'disk' && process.env.VERCEL) {
      throw new Error(
        'STORAGE_DRIVER=disk is not usable on Vercel (read-only, non-persistent filesystem). ' +
          'Set STORAGE_DRIVER=vercel-blob and attach a Vercel Blob store (BLOB_READ_WRITE_TOKEN).',
      );
    }
  }

  private async getS3() {
    if (this.s3Client) return this.s3Client;
    const { S3Client } = await import('@aws-sdk/client-s3');
    this.s3Client = new S3Client({
      endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || 'nexus_minio',
        secretAccessKey: process.env.S3_SECRET_KEY || 'nexus_minio_secret',
      },
      forcePathStyle: true,
    });
    return this.s3Client;
  }

  // ─── Signed-URL helpers (disk mode) ──────────────────────────────────────────
  private sign(key: string): string {
    return createHmac('sha256', this.urlSecret).update(key).digest('hex');
  }

  private verify(key: string, token: string): boolean {
    const expected = this.sign(key);
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private sanitizeSegment(s: string): string {
    // Strip anything that could escape the uploads dir or the two-segment key.
    return s.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  }

  // ─── Public API (unchanged signatures) ───────────────────────────────────────
  async upload(file: Express.Multer.File, folder: string): Promise<{ key: string; url: string }> {
    const safeFolder = this.sanitizeSegment(folder) || 'misc';
    const safeName = this.sanitizeSegment(file.originalname) || 'file';
    const key = `${safeFolder}/${randomUUID()}-${safeName}`;

    if (this.driver === 's3') {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const client = await this.getS3();
      await (client as { send: (c: unknown) => Promise<unknown> }).send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: file.buffer, ContentType: file.mimetype }),
      );
      return { key, url: this.getPublicUrl(key) };
    }

    if (this.driver === 'vercel-blob') {
      const { put } = await import('@vercel/blob');
      // Blob URLs already carry an unguessable random suffix, so — unlike the
      // disk/s3 drivers — the URL isn't reconstructable from `key` alone.
      // Store the full URL as the key; getPublicUrl() passes it straight through.
      const blob = await put(key, file.buffer, { access: 'public', contentType: file.mimetype });
      return { key: blob.url, url: blob.url };
    }

    const dest = path.join(this.uploadsDir, safeFolder);
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(this.uploadsDir, key), file.buffer);
    return { key, url: this.getPublicUrl(key) };
  }

  getPublicUrl(key: string): string {
    // vercel-blob keys are already full URLs (see upload() above).
    if (/^https?:\/\//.test(key)) return key;
    if (this.driver === 's3') {
      const endpoint = (process.env.S3_ENDPOINT || 'http://localhost:9000').replace(/\/+$/, '');
      return `${endpoint}/${this.bucket}/${key}`;
    }
    // Tamper-proof, unguessable link (strictly stronger than a bare object path):
    // a valid signature is only obtainable from an authenticated response.
    return `${this.apiBaseUrl}/api/v1/files/serve/${key}?t=${this.sign(key)}`;
  }

  /** Reads a disk-stored object for the signed serve route. Throws if the token is invalid or the path escapes the uploads dir. */
  async readSigned(key: string, token: string): Promise<StreamableFile> {
    if (!token || !this.verify(key, token)) throw new NotFoundException('File not found');

    const resolved = path.resolve(this.uploadsDir, key);
    if (resolved !== this.uploadsDir && !resolved.startsWith(this.uploadsDir + path.sep)) {
      throw new NotFoundException('File not found');
    }
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(resolved);
    } catch {
      throw new NotFoundException('File not found');
    }
    const type = MIME_BY_EXT[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
    return new StreamableFile(buffer, { type, disposition: 'inline' });
  }
}
