'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Navigation } from '@ayra/ui/components';
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  return (
    <header className="site-header container">
      <Link href="/" className="site-brand" aria-label="AYRA home" onClick={() => setOpen(false)}>
        <span className="site-mark" />
        AYRA
      </Link>
      <button
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="site-navigation"
        onClick={() => setOpen(!open)}
      >
        {open ? 'Close' : 'Menu'}
      </button>
      <div id="site-navigation" className={open ? 'is-open' : ''}>
        <Navigation label="Website navigation">
          {[
            ['/product', 'Product'],
            ['/security', 'Security'],
            ['/download', 'Download'],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href!}
              className={href === '/download' ? 'header-download' : ''}
              aria-current={path === href ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              {label}
            </Link>
          ))}
        </Navigation>
      </div>
    </header>
  );
}
