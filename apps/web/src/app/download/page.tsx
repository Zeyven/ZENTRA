import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@ayra/ui/icons';
import { Button, Card } from '@ayra/ui/components';
export const metadata: Metadata = {
  title: 'Download',
  description:
    'AYRA Desktop for macOS and Windows. Check release availability and installation details.',
};
export default function Download() {
  return (
    <>
      <section className="page-intro container">
        <span className="eyebrow">DOWNLOAD</span>
        <h1>
          Your next workspace.
          <br />
          On your desktop.
        </h1>
        <p>AYRA Desktop is being built for macOS and Windows.</p>
        <span className="release-badge">In development · Not publicly released</span>
      </section>
      <section className="download-platforms container" aria-label="Desktop releases">
        {[
          { id: 'macos', name: 'macOS', icon: 'mac' },
          { id: 'windows', name: 'Windows', icon: 'windows' },
        ].map((p) => (
          <Card key={p.id} className="platform-card" id={p.id}>
            <Icon name={p.icon as 'mac' | 'windows'} size={40} />
            <h2>AYRA for {p.name}</h2>
            <p>A focused home for deeper work.</p>
            <dl>
              <div>
                <dt>Availability</dt>
                <dd>Coming soon</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>No public release</dd>
              </div>
              <div>
                <dt>System requirements</dt>
                <dd>To be announced with the release</dd>
              </div>
            </dl>
            <Button disabled aria-describedby={`${p.id}-status`}>
              <Icon name="download" size={19} />
              Installer not available
            </Button>
            <p className="release-note" id={`${p.id}-status`}>
              There is no installer to download yet.
            </p>
          </Card>
        ))}
      </section>
      <section className="section container download-details">
        <h2>A clear path to getting started.</h2>
        <details>
          <summary>What will be included at release?</summary>
          <p>
            Supported operating systems and architectures, the version number, installation
            instructions, and verified installer information will be published together.
          </p>
        </details>
        <details>
          <summary>Can I use AYRA in my browser?</summary>
          <p>
            This website introduces AYRA and provides desktop downloads. Chat, Work, Build, and
            project work belong in the desktop application.
          </p>
        </details>
        <details>
          <summary>Is there a mobile app?</summary>
          <p>
            A mobile companion is planned for a later stage. No mobile download is available here.
          </p>
        </details>
        <Link className="text-link" href="/security">
          Read about privacy and security
          <Icon name="arrow" size={18} />
        </Link>
      </section>
    </>
  );
}
