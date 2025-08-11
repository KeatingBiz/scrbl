import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SCRBL',
  description: 'Snap work, get step-by-step help.',
  manifest: '/manifest.webmanifest',
  icons: [{ rel: 'icon', url: '/favicon.ico' }]
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* iOS PWA hooks */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icons/apple-icon-180.png" />
        <meta name="theme-color" content="#000000" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className="bg-black text-white">{children}</body>
    </html>
  );
}
