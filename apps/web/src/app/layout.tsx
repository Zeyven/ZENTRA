import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import '@ayra/ui/components.css';
import './website.css';
import { SiteHeader } from '../components/site-header';
import { SiteFooter } from '../components/shared';
export const metadata: Metadata = {
  title: { default: 'AYRA — One workspace for deeper work.', template: '%s · AYRA' },
  description:
    'A unified desktop AI workspace for research, execution, and creation. Discover AYRA for macOS and Windows.',
  icons: { icon: '/icon.png' },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <SiteHeader />
        <main id="content">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
