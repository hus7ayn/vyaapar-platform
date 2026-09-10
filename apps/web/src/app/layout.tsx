import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'MSW Global — Billing, Accounting & Inventory',
  description: 'Enterprise SaaS for retail and hospitality',
};

// Explicit so phones/tablets lay out at device width and `env(safe-area-inset-*)`
// resolves (the fixed mobile bottom nav relies on it via `.pb-safe`). Pinch-zoom is
// left enabled on purpose — shop staff use it to read dense tables.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
