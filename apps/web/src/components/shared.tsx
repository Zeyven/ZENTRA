import Link from 'next/link';
import Image from 'next/image';
import { Icon } from '@ayra/ui/icons';
export function DownloadLinks() {
  return (
    <div className="download-links">
      <Link href="/download#macos" className="ay-button ay-button--primary">
        <Icon name="mac" size={19} />
        Download for macOS
      </Link>
      <Link href="/download#windows" className="ay-button ay-button--secondary">
        <Icon name="windows" size={19} />
        Download for Windows
      </Link>
    </div>
  );
}
export function ProductImage({ priority = false }: { priority?: boolean }) {
  return (
    <figure className="product-image">
      <Image
        src="/ayra-desktop-macbook.png"
        alt="AYRA desktop workspace shown on a silver MacBook"
        width={1536}
        height={1024}
        sizes="(max-width: 760px) 100vw, 60vw"
        {...(priority ? { preload: true } : {})}
      />
      <figcaption>Product vision. Interface shown for illustration.</figcaption>
    </figure>
  );
}
export function DownloadSection() {
  return (
    <section className="download-section section container">
      <span className="eyebrow">YOUR NEXT WORKSPACE</span>
      <h2>AYRA Desktop</h2>
      <p>
        A little more space.
        <br className="mobile-break" /> A lot more possibility.
      </p>
      <DownloadLinks />
      <p className="release-note">
        Desktop release coming soon. No public installer is available yet.
      </p>
    </section>
  );
}
export function SiteFooter() {
  return (
    <footer className="site-footer container">
      <div>
        <Link href="/" className="site-brand">
          <span className="site-mark" />
          AYRA
        </Link>
        <p>One workspace for deeper work.</p>
      </div>
      <nav aria-label="Footer navigation">
        <Link href="/product">Product</Link>
        <Link href="/download">Download</Link>
        <Link href="/security">Security</Link>
      </nav>
      <span>AYRA · In development</span>
    </footer>
  );
}
