import type { Metadata } from 'next';
import { PortalAuthProvider } from '@/lib/portal-auth-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'Client Portal — MEA Agency',
  description: 'CDPS Client Portal — service progress, reports, and support for MEA Agency clients',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>
        <PortalAuthProvider>{children}</PortalAuthProvider>
      </body>
    </html>
  );
}
