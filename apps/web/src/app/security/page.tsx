import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@ayra/ui/icons';
export const metadata: Metadata = {
  title: 'Privacy & Security',
  description:
    'AYRA’s approach to permissions, approvals, and data handling, with a clear distinction between design commitments and release readiness.',
};
export default function Security() {
  return (
    <>
      <section className="page-intro container">
        <span className="eyebrow">PRIVACY & SECURITY</span>
        <h1>
          Your work deserves
          <br />
          care and clarity.
        </h1>
        <p>
          You should understand what AYRA can access,
          <br />
          what it is doing, and what needs your approval.
        </p>
      </section>
      <section className="security-status container">
        <Icon name="security" size={28} />
        <div>
          <h2>A clear statement of where we are.</h2>
          <p>
            AYRA is in development. The principles below describe the product’s design requirements.
            They are not a claim of a completed security audit, certification, or production
            readiness.
          </p>
        </div>
      </section>
      <section className="section container security-principles">
        {[
          {
            icon: 'lock',
            title: 'Access with boundaries.',
            text: 'Workspace permissions should determine which projects, tasks, and resources a person or an AI action can access.',
          },
          {
            icon: 'check',
            title: 'Approval where it matters.',
            text: 'Consequential actions should make their purpose and effects clear, with a chance to review before proceeding.',
          },
          {
            icon: 'context',
            title: 'Understand your data’s path.',
            text: 'Some capabilities may send relevant data to configured service providers. Running a desktop app does not mean all processing happens locally.',
          },
          {
            icon: 'artifact',
            title: 'Control the work you keep.',
            text: 'Retention, export, and deletion behavior must be explicit. Detailed controls and recovery limits will be documented before release.',
          },
        ].map((p) => (
          <article key={p.title}>
            <Icon name={p.icon as 'lock' | 'check' | 'context' | 'artifact'} size={28} />
            <div>
              <h2>{p.title}</h2>
              <p>{p.text}</p>
            </div>
          </article>
        ))}
      </section>
      <section className="security-release container">
        <span className="eyebrow">BEFORE PUBLIC RELEASE</span>
        <h2>Evidence before promises.</h2>
        <p>
          Release documentation will explain supported security controls, provider data handling,
          update verification, and how to report a concern. Until then, AYRA should not be treated
          as a production service for sensitive work.
        </p>
        <Link href="/download" className="text-link">
          Check release availability
          <Icon name="arrow" size={18} />
        </Link>
      </section>
    </>
  );
}
