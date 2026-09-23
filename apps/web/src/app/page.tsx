import Link from 'next/link';
import { Icon } from '@ayra/ui/icons';
import { DownloadLinks, DownloadSection, ProductImage } from '../components/shared';
import { Overview } from '../components/overview';
export default function Home() {
  return (
    <>
      <section className="hero-section container">
        <div className="hero-text">
          <p className="eyebrow">THINK CLEARER. GO FURTHER.</p>
          <h1>
            One workspace
            <br />
            for deeper work.
          </h1>
          <p className="hero-subtitle">
            A unified AI workspace for research, execution, and creation.
          </p>
          <DownloadLinks />
          <Overview />
          <p className="release-note">AYRA Desktop for macOS and Windows · Coming soon</p>
        </div>
        <ProductImage priority />
      </section>
      <section className="section intro-section container">
        <span className="eyebrow">WHAT IS AYRA</span>
        <h2>
          A desktop space
          <br />
          for deeper work.
        </h2>
        <p>Research, execution, and creation — with your work at the center.</p>
        <div className="capability-grid">
          {[
            { name: 'Chat', copy: 'Think with AI.', icon: 'chat' },
            { name: 'Work', copy: 'Turn ideas into outcomes.', icon: 'work' },
            { name: 'Build', copy: 'Create software with AI.', icon: 'build' },
          ].map(({ name, copy, icon }) => (
            <Link
              href={`/product#${name.toLowerCase()}`}
              className={`capability-card capability-${name.toLowerCase()}`}
              key={name}
            >
              <Icon name={icon as 'chat' | 'work' | 'build'} size={34} />
              <h3>{name}</h3>
              <p>{copy}</p>
            </Link>
          ))}
        </div>
      </section>
      <section className="principles-section">
        <div className="container section">
          <span className="eyebrow">PRODUCT PRINCIPLES</span>
          <h2>Why AYRA.</h2>
          <div className="principle-grid">
            {[
              { name: 'Context Continuity', copy: 'AI remembers your work.', icon: 'context' },
              {
                name: 'Unified Artifacts',
                copy: 'Everything becomes usable output.',
                icon: 'artifact',
              },
              { name: 'Long-running Agents', copy: 'Complex work can continue.', icon: 'time' },
              { name: 'Privacy First', copy: 'Your data stays yours.', icon: 'security' },
            ].map(({ name, copy, icon }) => (
              <article key={name}>
                <Icon name={icon as 'context' | 'artifact' | 'time' | 'security'} size={26} />
                <h3>{name}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="section container agent-section">
        <div>
          <span className="eyebrow">AI AGENT CAPABILITY</span>
          <h2>
            Give it a goal.
            <br />
            Stay in control.
          </h2>
          <p>
            Follow the work. Review the outcome.
            <br />
            Keep the important decisions yours.
          </p>
          <ol className="goal-flow">
            <li>
              <Icon name="goal" />
              <div>
                <small>Goal</small>
                <strong>Prepare a research brief</strong>
              </div>
            </li>
            <li>
              <Icon name="time" />
              <div>
                <small>Progress</small>
                <strong>AYRA is working…</strong>
              </div>
            </li>
            <li>
              <Icon name="check" />
              <div>
                <small>Result</small>
                <strong>Review your report</strong>
              </div>
            </li>
          </ol>
          <small className="release-note">An example of the experience we’re building.</small>
        </div>
        <div className="artifact-illustration">
          <div className="artifact-paper">
            <span className="eyebrow">RESEARCH BRIEF · EXAMPLE</span>
            <Icon name="artifact" size={32} />
            <h3>
              A clearer view.
              <br />A useful next step.
            </h3>
            <p>Findings, sources, and recommendations in one document.</p>
            <span className="artifact-bottom">AYRA / Work</span>
          </div>
        </div>
      </section>
      <section className="security-teaser container">
        <Icon name="security" size={42} />
        <div>
          <span className="eyebrow">PRIVACY & SECURITY</span>
          <h2>Your work deserves care.</h2>
          <p>Understand permissions, approvals, and how your data is handled.</p>
          <Link className="text-link" href="/security">
            Explore security
            <Icon name="arrow" size={18} />
          </Link>
        </div>
      </section>
      <DownloadSection />
    </>
  );
}
