'use client';
import { useState, type ReactNode } from 'react';
import type { Surface } from './foundation';
import avatar from './assets/taylor-demo.png';
import landscape from './assets/alpine-lake.png';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Calendar,
  ChartBar,
  Check,
  CheckCircle,
  Clock,
  Code,
  FileText,
  Folder,
  Globe,
  Lightbulb,
  ListBullets,
  MagnifyingGlass,
  Sparkle,
  Stack,
  Target,
  TrendUp,
  Users,
} from '@phosphor-icons/react';
import './sample-workspace.css';

type SampleProps = {
  surface: Extract<Surface, 'Home' | 'Chat' | 'Work' | 'Build' | 'Projects' | 'Activity'>;
  onNavigate: (surface: Surface) => void;
  onUseOwn: (surface: Surface) => void;
};

const projectSamples = [
  {
    title: 'Customer Portal',
    area: 'Build',
    description: 'A modern customer portal with helpful support.',
    status: 'In progress',
    tone: 'blue',
  },
  {
    title: 'Q2 Strategy',
    area: 'Work',
    description: 'Market analysis and recommendations for Q2.',
    status: 'In progress',
    tone: 'violet',
  },
  {
    title: 'Design System',
    area: 'Build',
    description: 'A unified design language for AYRA.',
    status: 'In review',
    tone: 'peach',
  },
  {
    title: 'Research Library',
    area: 'Work',
    description: 'Curated insights and source material.',
    status: 'Active',
    tone: 'mint',
  },
] as const;

function SampleLabel() {
  return (
    <div className="sample-label">
      <Sparkle size={15} /> Sample workspace <span>Illustrative content · no live data</span>
    </div>
  );
}
function Avatar({ size = 'small' }: { size?: 'small' | 'large' }) {
  return <img className={`sample-avatar ${size}`} src={avatar} alt="Fictional sample profile" />;
}
function SectionTitle({ children, onSeeAll }: { children: ReactNode; onSeeAll?: () => void }) {
  return (
    <div className="sample-section-title">
      <h2>{children}</h2>
      {onSeeAll && (
        <button onClick={onSeeAll}>
          See all <ArrowRight size={15} />
        </button>
      )}
    </div>
  );
}

function SampleChat({
  onNavigate,
  onUseOwn,
}: {
  onNavigate: (surface: Surface) => void;
  onUseOwn: (surface: Surface) => void;
}) {
  const [sourceOpen, setSourceOpen] = useState(false);
  return (
    <div className="sample-page">
      <SampleLabel />
      <div className="sample-chat-layout">
        <div className="sample-conversation sample-panel">
          <div className="sample-chat-header">
            <span>
              <Sparkle size={23} /> Market analysis for AI developer tools
            </span>
            <button className="sample-text-button" onClick={() => onUseOwn('Chat')}>
              Start your own <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="sample-message-user">
            <Avatar />
            <p>
              I’m working on our Q2 strategy and need a market analysis for AI developer tools. Can
              you give me an overview of the current market, key players, and emerging trends?
            </p>
          </div>
          <div className="sample-message-answer">
            <span className="sample-answer-mark">A</span>
            <div>
              <p>
                Here’s an illustrative overview of the AI developer tools market, with opportunities
                relevant to AYRA.
              </p>
              <article className="sample-answer-card">
                <h3>
                  <ChartBar size={20} /> 1. Market Overview
                </h3>
                <p>
                  Demand for integrated AI development workflows is expanding. Teams increasingly
                  need a clear path from research to usable output.
                </p>
                <div className="sample-insight-grid">
                  {[
                    ['24.5B', 'Market size example'],
                    ['60.8B', 'Projected size example'],
                    ['3.2M+', 'Developer example'],
                    ['2.8B', 'Funding example'],
                  ].map(([value, label]) => (
                    <div key={label}>
                      <strong>{value}</strong>
                      <small>{label}</small>
                    </div>
                  ))}
                </div>
                <h3>
                  <Users size={20} /> 2. Key Players
                </h3>
                <p>
                  Established technology companies and specialized startups both shape this space.
                </p>
                <div className="sample-chips">
                  {['OpenAI', 'Anthropic', 'Google', 'Microsoft', 'Cursor', 'Replit'].map(
                    (name) => (
                      <span key={name}>{name}</span>
                    ),
                  )}
                </div>
                <h3>
                  <TrendUp size={20} /> 3. Emerging Trends
                </h3>
                <ol className="sample-trends">
                  <li>End-to-end platforms are gaining traction beyond model access.</li>
                  <li>Integration with real data, tools, and workflows matters more.</li>
                  <li>Smaller models and agent workflows enable new use cases.</li>
                  <li>Developer experience and governance are rising priorities.</li>
                </ol>
                <h3>
                  <Lightbulb size={20} /> 4. Opportunities for AYRA
                </h3>
                <p>
                  A unified workspace can bring research, creation, and execution together. Sources
                  and review should remain visible throughout the work.
                </p>
                <button className="sample-source-link" onClick={() => setSourceOpen(!sourceOpen)}>
                  <BookOpen size={16} />{' '}
                  {sourceOpen ? 'Hide sample source notes' : 'View sample source notes'}{' '}
                  <ArrowRight size={15} />
                </button>
                {sourceOpen && (
                  <p className="sample-disclaimer">
                    This is demonstration copy. Figures above are placeholders for layout review and
                    are not verified market data.
                  </p>
                )}
              </article>
            </div>
          </div>
          <div className="sample-chat-prompts">
            <button onClick={() => onNavigate('Work')}>
              Turn this into a document <ArrowRight size={15} />
            </button>
            <button onClick={() => onUseOwn('Chat')}>
              Ask your own question <ArrowRight size={15} />
            </button>
          </div>
          <div className="sample-compose">
            <span>Ask AYRA anything…</span>
            <button onClick={() => onUseOwn('Chat')}>
              Open my notes <ArrowRight size={15} />
            </button>
          </div>
        </div>
        <aside className="sample-context">
          <section className="sample-panel">
            <SectionTitle>Context</SectionTitle>
            <h3>Linked Project</h3>
            <button className="sample-linked" onClick={() => onNavigate('Projects')}>
              <span className="sample-icon tone-violet">
                <FileText size={19} />
              </span>
              <span>
                Q2 Strategy<small>Market analysis and recommendations</small>
              </span>
              <ArrowRight size={16} />
            </button>
            <h3>Related Tasks</h3>
            {[
              'Compile market research data',
              'Analyze key competitors',
              'Draft strategic recommendations',
            ].map((task, index) => (
              <div className="sample-list-row" key={task}>
                <span className={index === 1 ? 'sample-check checked' : 'sample-check'}>
                  {index === 1 && <Check size={13} />}
                </span>
                <span>
                  {task}
                  <small>{index === 1 ? 'Completed' : 'Upcoming'}</small>
                </span>
              </div>
            ))}
            <h3>Connected Resources</h3>
            {['AI developer tools report', 'Competitive landscape', 'User research insights'].map(
              (resource) => (
                <div className="sample-list-row" key={resource}>
                  <FileText size={17} />
                  <span>
                    {resource}
                    <small>Sample resource</small>
                  </span>
                </div>
              ),
            )}
          </section>
          <section className="sample-panel">
            <SectionTitle>Generated in this chat</SectionTitle>
            <button className="sample-artifact" onClick={() => onNavigate('Work')}>
              <span
                className="sample-artifact-image"
                style={{ backgroundImage: `url(${landscape})` }}
              />
              <span>
                <strong>Q2 Market Analysis</strong>
                <small>Example document · Open in Work</small>
              </span>
              <ArrowRight size={16} />
            </button>
          </section>
          <section className="sample-panel">
            <SectionTitle>Suggested Follow-ups</SectionTitle>
            {[
              'Create a competitor comparison',
              'Draft a go-to-market strategy',
              'Outline the executive summary',
            ].map((item) => (
              <button className="sample-followup" key={item} onClick={() => onUseOwn('Chat')}>
                <ArrowRight size={14} />
                {item}
              </button>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}

const workSections = [
  'Executive Summary',
  'Market Overview',
  'Key Players',
  'Market Trends',
  'Opportunities',
  'Risks & Challenges',
  'Recommendations',
  'Conclusion',
  'References',
] as const;
function SampleWork({ onUseOwn }: { onUseOwn: (surface: Surface) => void }) {
  const [section, setSection] = useState<(typeof workSections)[number]>(workSections[0]);
  const [tab, setTab] = useState<'Sources' | 'Insights' | 'Artifacts'>('Sources');
  return (
    <div className="sample-page">
      <SampleLabel />
      <div className="sample-work-heading">
        <div>
          <p className="sample-breadcrumb">
            Work &nbsp; / &nbsp; Research &nbsp; / &nbsp; Market Analysis
          </p>
          <h1>
            AI Developer Tools Market Analysis <span className="sample-pill">Draft</span>
          </h1>
          <small>Illustrative document · Layout preview</small>
        </div>
        <button className="sample-primary" onClick={() => onUseOwn('Work')}>
          Create my document <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="sample-work-layout">
        <aside className="sample-outline sample-panel">
          <div className="sample-segment">
            <button className="active">Outline</button>
            <button onClick={() => setTab('Insights')}>Notes</button>
          </div>
          {workSections.map((name, index) => (
            <button
              className={section === name ? 'active' : ''}
              key={name}
              onClick={() => setSection(name)}
            >
              <span>{index + 1}.</span>
              {name}
            </button>
          ))}
          <div className="sample-assistant">
            <Target size={22} />
            <h3>Research assistant</h3>
            <p>AYRA is gathering sources, analyzing themes, and drafting.</p>
            {[
              'Gathering sources',
              'Analyzing key trends',
              'Generating charts',
              'Drafting section content',
            ].map((step, index) => (
              <div key={step}>
                <span className={index < 3 ? 'sample-check checked' : 'sample-check'}>
                  {index < 3 && <Check size={12} />}
                </span>
                {step}
              </div>
            ))}
          </div>
        </aside>
        <article className="sample-document sample-panel">
          <div className="sample-editor-toolbar">
            <button onClick={() => setSection(workSections[0])}>Heading 1</button>
            <span>B</span>
            <span>
              <i>I</i>
            </span>
            <span>U</span>
            <ListBullets size={18} />
            <span>≡</span>
            <FileText size={17} />
          </div>
          <div className="sample-document-body">
            <span className="sample-eyebrow">MARKET ANALYSIS</span>
            <h1>
              AI Developer Tools
              <br />
              Market Analysis
            </h1>
            <p className="sample-document-subtitle">
              Market trends, key players, opportunities, and recommendations.
            </p>
            <div className="sample-document-meta">
              <Avatar />
              <span>
                Prepared for Taylor Kim<small>Acme Studio · Sample workspace</small>
              </span>
              <span className="sample-meta-divider" />
              <BookOpen size={19} />
              <span>
                8 sample sources<small>Illustrative only</small>
              </span>
            </div>
            <div className="sample-ai-note">
              <Sparkle size={22} />
              <span>
                AYRA has prepared a draft from sample material.
                <small>Review sources and make it your own.</small>
              </span>
              <button onClick={() => onUseOwn('Work')}>Start my draft</button>
            </div>
            <h2>
              {workSections.indexOf(section) + 1}. {section}
            </h2>
            <p>
              {section === 'Executive Summary'
                ? 'AI developer tools are entering a new phase as teams seek more connected workflows. This example report shows how research, analysis, and output can live together in one calm workspace.'
                : `This sample ${section.toLowerCase()} section illustrates a structured research document with references, insights, and clear next steps.`}
            </p>
            <div className="sample-document-stats">
              {[
                ['12.4B', 'Market size'],
                ['36.8B', 'Projected'],
                ['1,200+', 'Active startups'],
                ['67%', 'Adoption example'],
              ].map(([value, label]) => (
                <div key={label}>
                  <small>{label}</small>
                  <strong>{value}</strong>
                  <span>Illustrative figure</span>
                </div>
              ))}
            </div>
            <blockquote>
              “AI developer tools are becoming a new layer for modern software development.”
              <small>— Example research note</small>
            </blockquote>
          </div>
        </article>
        <aside className="sample-work-rail">
          <div className="sample-segment">
            {(['Sources', 'Insights', 'Artifacts'] as const).map((name) => (
              <button
                key={name}
                className={tab === name ? 'active' : ''}
                onClick={() => setTab(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <section className="sample-panel">
            <div className="sample-search-line">
              <MagnifyingGlass size={17} /> Search {tab.toLowerCase()}…
            </div>
            {(tab === 'Sources'
              ? [
                  'The State of AI Development Tools',
                  'AI Developer Economy Report',
                  'Generative AI Developer Survey',
                  'The Developer Tools Landscape',
                  'AI Infrastructure Market Sizing',
                ]
              : tab === 'Insights'
                ? [
                    'Enterprise demand is accelerating',
                    'Productivity drives adoption',
                    'Open models increase competition',
                  ]
                : ['Market comparison table', 'Executive summary', 'Opportunity map']
            ).map((name, index) => (
              <button
                className="sample-resource"
                key={name}
                onClick={() => setSection(workSections[Math.min(index + 1, 8)] ?? workSections[0])}
              >
                <span className={`sample-icon tone-${index % 2 ? 'mint' : 'peach'}`}>
                  {tab === 'Insights' ? <Lightbulb size={17} /> : <FileText size={17} />}
                </span>
                <span>
                  {name}
                  <small>
                    {tab === 'Sources' ? 'Example source · Not connected' : 'Sample item'}
                  </small>
                </span>
              </button>
            ))}
          </section>
          <section className="sample-panel sample-key-insights">
            <h3>
              <Lightbulb size={19} /> Key insights from sources
            </h3>
            {[
              'Teams seek a single view of ongoing work.',
              'Developer productivity is a purchasing driver.',
              'Transparent sources improve trust.',
            ].map((item) => (
              <p key={item}>{item}</p>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}

const codeLines = [
  "import { DashboardLayout } from '@/components/layouts/dashboard'",
  "import { MetricsCard } from '@/components/ui/metrics-card'",
  "import { RecentActivity } from '@/components/dashboard/recent-activity'",
  '',
  'export default async function DashboardPage() {',
  '  const stats = await getCustomerStats()',
  '',
  '  return (',
  '    <DashboardLayout>',
  '      <div className="space-y-6">',
  '        <h1>Welcome back</h1>',
  '        <MetricsCard stats={stats} />',
  '        <RecentActivity />',
  '      </div>',
  '    </DashboardLayout>',
  '  )',
  '}',
];
const layoutLines = [
  "import type { ReactNode } from 'react'",
  '',
  'export function DashboardLayout({ children }: { children: ReactNode }) {',
  '  return <main className="dashboard">{children}</main>',
  '}',
];
const packageLines = [
  '{',
  '  "name": "customer-portal",',
  '  "private": true,',
  '  "scripts": { "dev": "next dev", "test": "vitest run" }',
  '}',
];
function SampleBuild({ onUseOwn }: { onUseOwn: (surface: Surface) => void }) {
  const [tab, setTab] = useState('Code');
  const [file, setFile] = useState('page.tsx');
  const tabs = ['Code', 'Plan', 'Diff', 'Tests', 'Preview', 'Logs'];
  return (
    <div className="sample-page">
      <SampleLabel />
      <div className="sample-build-heading">
        <div>
          <p className="sample-breadcrumb">Build &nbsp; › &nbsp; Customer Portal v1</p>
          <h1>
            <span className="sample-icon tone-blue">
              <Code size={22} />
            </span>{' '}
            Customer Portal v1 <span className="sample-pill progress">In progress</span>
          </h1>
          <p>A modern customer portal with account management and billing.</p>
        </div>
        <button className="sample-primary" onClick={() => onUseOwn('Build')}>
          Start my build <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="sample-build-tabs">
        {tabs.map((name) => (
          <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </div>
      <div className="sample-build-layout">
        <aside className="sample-files sample-panel">
          <SectionTitle>Files</SectionTitle>
          <div className="sample-file-root">
            <Folder size={18} /> customer-portal
          </div>
          {[
            'app',
            '(auth)',
            'api',
            'dashboard',
            'page.tsx',
            'layout.tsx',
            'components',
            'lib',
            'styles',
            'tests',
            'package.json',
          ].map((name, index) =>
            name.includes('.') ? (
              <button
                key={name}
                className={file === name ? 'active' : ''}
                onClick={() => {
                  setFile(name);
                  setTab('Code');
                }}
                style={{ paddingLeft: index === 4 || index === 5 ? 39 : 21 }}
              >
                <FileText size={16} />
                {name}
              </button>
            ) : (
              <div key={name} className="sample-folder" style={{ paddingLeft: 21 }}>
                <Folder size={16} />
                {name}
              </div>
            ),
          )}
        </aside>
        <section className="sample-code sample-panel">
          <div className="sample-code-title">
            <span>{tab === 'Code' ? file : tab}</span>
            <span>Sample repository · read only</span>
          </div>
          {tab === 'Code' ? (
            <pre>
              {(file === 'page.tsx'
                ? codeLines
                : file === 'layout.tsx'
                  ? layoutLines
                  : packageLines
              ).map((line, index) => (
                <span key={index}>
                  <i>{index + 1}</i>
                  {line}
                </span>
              ))}
            </pre>
          ) : tab === 'Plan' ? (
            <div className="sample-tab-content">
              <h2>Implementation plan</h2>
              {[
                'Inspect the project structure',
                'Build the dashboard',
                'Run tests and type checks',
                'Review changes',
              ].map((step, index) => (
                <p key={step}>
                  <span className="sample-check checked">
                    <Check size={12} />
                  </span>{' '}
                  {index + 1}. {step}
                </p>
              ))}
            </div>
          ) : tab === 'Diff' ? (
            <div className="sample-tab-content">
              <h2>Changes ready for review</h2>
              <p>2 files changed · 24 additions · 6 deletions</p>
              <pre>
                + &lt;MetricsCard stats={'{stats}'} /&gt;{'\n'}+ &lt;RecentActivity /&gt;
              </pre>
            </div>
          ) : tab === 'Tests' ? (
            <div className="sample-tab-content">
              <h2>Test results</h2>
              <p>10 passing · 2 failing in this illustrative build.</p>
              <p>✓ Dashboard renders without errors</p>
              <p>✓ Customer metrics load</p>
              <p>× Empty state needs review</p>
            </div>
          ) : tab === 'Preview' ? (
            <div className="sample-preview">
              <div className="sample-preview-nav">
                Customer Portal
                <br />
                <small>
                  Dashboard
                  <br />
                  Customers
                  <br />
                  Messages
                  <br />
                  Billing
                </small>
              </div>
              <div>
                <h2>Welcome back</h2>
                <p>Here’s what’s happening with your customers today.</p>
                <div className="sample-preview-metrics">
                  <span>
                    Customers<strong>2,847</strong>
                  </span>
                  <span>
                    Active users<strong>1,992</strong>
                  </span>
                  <span>
                    Support tickets<strong>24</strong>
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="sample-tab-content">
              <h2>Activity log</h2>
              <p>10:14 · Inspected codebase</p>
              <p>10:16 · Prepared implementation plan</p>
              <p>10:19 · Generated dashboard changes</p>
            </div>
          )}
        </section>
        <aside className="sample-agent sample-panel">
          <div className="sample-agent-heading">
            <span className="sample-icon tone-blue">
              <Sparkle size={20} />
            </span>
            <h2>AYRA Agent</h2>
            <small>Example progress</small>
          </div>
          {['Inspect', 'Plan', 'Code', 'Test', 'Review'].map((step, index) => (
            <div key={step} className={`sample-agent-step ${index === 2 ? 'active' : ''}`}>
              <span className={index < 2 ? 'sample-check checked' : 'sample-check'}>
                {index < 2 && <Check size={12} />}
              </span>
              <span>
                {step}
                <small>
                  {
                    [
                      'Scanned the codebase',
                      'Created a four-step plan',
                      'Implementing dashboard analytics',
                      'Running checks',
                      'Awaiting your review',
                    ][index]
                  }
                </small>
              </span>
            </div>
          ))}
          <div className="sample-agent-note">
            <Sparkle size={18} /> I’m adding a dashboard section with customer metrics and recent
            activity.
          </div>
          <button className="sample-primary" onClick={() => onUseOwn('Build')}>
            Open my workspace <ArrowRight size={15} />
          </button>
        </aside>
      </div>
      <div className="sample-build-bottom">
        <section className="sample-panel">
          <SectionTitle onSeeAll={() => setTab('Tests')}>Tests</SectionTitle>
          <div className="sample-test-metrics">
            <strong>
              12 <small>Total</small>
            </strong>
            <strong>
              10 <small>Passing</small>
            </strong>
            <strong>
              2 <small>Failing</small>
            </strong>
          </div>
          <p>✓ Dashboard renders without errors</p>
          <p>✓ Customer metrics load</p>
          <p>× Empty state needs review</p>
        </section>
        <section className="sample-panel">
          <SectionTitle onSeeAll={() => setTab('Diff')}>Diff</SectionTitle>
          <p>2 files changed</p>
          <pre>
            + MetricsCard
            <br />+ RecentActivity
            <br />− Placeholder panel
          </pre>
        </section>
        <section className="sample-panel">
          <SectionTitle onSeeAll={() => setTab('Preview')}>Preview</SectionTitle>
          <div className="sample-preview-mini">
            Customer Portal <strong>Welcome back</strong>
            <span>2,847 customers &nbsp; · &nbsp; 1,992 active users</span>
          </div>
        </section>
      </div>
    </div>
  );
}

function SampleProjects({
  onNavigate,
  onUseOwn,
}: {
  onNavigate: (surface: Surface) => void;
  onUseOwn: (surface: Surface) => void;
}) {
  const [selected, setSelected] = useState(0);
  const project = projectSamples[selected] ?? projectSamples[0];
  return (
    <div className="sample-page">
      <SampleLabel />
      <div className="sample-projects-heading">
        <div>
          <p className="sample-breadcrumb">Workspace &nbsp; / &nbsp; Projects</p>
          <h1>Projects</h1>
          <p>Everything moving forward, together.</p>
        </div>
        <button className="sample-primary" onClick={() => onUseOwn('Projects')}>
          Open my projects <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="sample-projects-layout">
        <div className="sample-projects-list">
          <SectionTitle>Recent Projects</SectionTitle>
          {projectSamples.map((item, index) => (
            <button
              className={`sample-project-list-card ${selected === index ? 'active' : ''}`}
              key={item.title}
              onClick={() => setSelected(index)}
            >
              <span className={`sample-icon tone-${item.tone}`}>
                <Folder size={21} />
              </span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
              <span className="sample-status">{item.status}</span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
        <section className="sample-project-detail sample-panel">
          <span className={`sample-icon tone-${project.tone}`}>
            <Folder size={25} />
          </span>
          <p className="sample-eyebrow">{project.area.toUpperCase()} PROJECT</p>
          <h2>{project.title}</h2>
          <p>{project.description}</p>
          <div className="sample-project-detail-meta">
            <span>
              <Users size={17} /> 3 people
            </span>
            <span>
              <Clock size={17} /> Updated recently
            </span>
            <span className="sample-status">{project.status}</span>
          </div>
          <div className="sample-project-detail-grid">
            <div>
              <Target size={20} />
              <h3>Goal</h3>
              <p>Bring the team’s ideas into one focused outcome.</p>
            </div>
            <div>
              <ListBullets size={20} />
              <h3>Progress</h3>
              <p>Research, drafts, and review are moving forward.</p>
            </div>
            <div>
              <Stack size={20} />
              <h3>Artifacts</h3>
              <p>Documents and project resources stay together.</p>
            </div>
          </div>
          <h3>Next steps</h3>
          {['Review current work', 'Refine the deliverable', 'Share with the team'].map(
            (step, index) => (
              <div className="sample-list-row" key={step}>
                <span className={index === 0 ? 'sample-check checked' : 'sample-check'}>
                  {index === 0 && <Check size={12} />}
                </span>
                {step}
              </div>
            ),
          )}
          <button
            className="sample-primary"
            onClick={() => onNavigate(project.area === 'Build' ? 'Build' : 'Work')}
          >
            Open {project.area} <ArrowRight size={15} />
          </button>
        </section>
      </div>
    </div>
  );
}

function SampleActivity({ onNavigate }: { onNavigate: (surface: Surface) => void }) {
  const [filter, setFilter] = useState('All');
  const activity = [
    {
      title: 'Market analysis updated',
      detail: 'The research draft has new findings to review.',
      time: '2h ago',
      type: 'Work',
      target: 'Work' as const,
      Icon: BookOpen,
    },
    {
      title: 'Q2 Strategy Report edited',
      detail: 'Executive summary draft added.',
      time: '4h ago',
      type: 'Work',
      target: 'Work' as const,
      Icon: FileText,
    },
    {
      title: 'Customer Portal build progressed',
      detail: 'Three example commits prepared for review.',
      time: '5h ago',
      type: 'Build',
      target: 'Build' as const,
      Icon: Code,
    },
    {
      title: 'Project review completed',
      detail: 'Design System moved to review.',
      time: '8h ago',
      type: 'Projects',
      target: 'Projects' as const,
      Icon: CheckCircle,
    },
  ];
  return (
    <div className="sample-page">
      <SampleLabel />
      <div className="sample-projects-heading">
        <div>
          <p className="sample-breadcrumb">Workspace &nbsp; / &nbsp; Activity</p>
          <h1>Activity</h1>
          <p>A clear view of what moved forward.</p>
        </div>
      </div>
      <section className="sample-panel sample-activity-page">
        <SectionTitle>Recent Activity</SectionTitle>
        <div className="sample-activity-filters">
          {['All', 'Work', 'Build', 'Projects'].map((name) => (
            <button
              key={name}
              className={filter === name ? 'active' : ''}
              onClick={() => setFilter(name)}
            >
              {name}
            </button>
          ))}
        </div>
        {activity
          .filter((item) => filter === 'All' || item.type === filter)
          .map((item) => (
            <button
              className="sample-activity-item"
              key={item.title}
              onClick={() => onNavigate(item.target)}
            >
              <span className="sample-icon tone-blue">
                <item.Icon size={20} />
              </span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              <time>{item.time}</time>
              <ArrowRight size={16} />
            </button>
          ))}
      </section>
    </div>
  );
}

export function SampleWorkspace({ surface, onNavigate, onUseOwn }: SampleProps) {
  if (surface === 'Home') return <SampleHome onNavigate={onNavigate} />;
  if (surface === 'Chat') return <SampleChat onNavigate={onNavigate} onUseOwn={onUseOwn} />;
  if (surface === 'Work') return <SampleWork onUseOwn={onUseOwn} />;
  if (surface === 'Build') return <SampleBuild onUseOwn={onUseOwn} />;
  if (surface === 'Activity') return <SampleActivity onNavigate={onNavigate} />;
  return <SampleProjects onNavigate={onNavigate} onUseOwn={onUseOwn} />;
}

function SampleHome({ onNavigate }: { onNavigate: (surface: Surface) => void }) {
  const metrics = [
    {
      value: '12',
      label: 'Active tasks',
      detail: '5 due this week',
      Icon: CheckCircle,
      tone: 'blue',
    },
    {
      value: '4',
      label: 'Active projects',
      detail: '2 near completion',
      Icon: Folder,
      tone: 'violet',
    },
    {
      value: '18',
      label: 'Artifacts created',
      detail: 'Reports, docs, designs',
      Icon: FileText,
      tone: 'peach',
    },
    {
      value: '3',
      label: 'Pending approvals',
      detail: '1 high priority',
      Icon: Users,
      tone: 'rose',
    },
  ] as const;
  const working = [
    {
      label: 'RESEARCH',
      title: 'Market analysis: AI tools',
      description: 'Analyzing trends, competitors, and opportunities…',
      progress: 70,
      tone: 'blue',
      target: 'Chat',
    },
    {
      label: 'DOCUMENT',
      title: 'Q2 Strategy Report',
      description: 'Drafting recommendations and an executive summary…',
      progress: 40,
      tone: 'violet',
      target: 'Work',
    },
    {
      label: 'BUILD',
      title: 'Customer Portal v1',
      description: 'Implementing the dashboard and account flow…',
      progress: 60,
      tone: 'mint',
      target: 'Build',
    },
  ] as const;
  return (
    <div className="sample-page sample-home">
      <SampleLabel />
      <div className="sample-home-grid">
        <div className="sample-home-main">
          <section
            className="sample-hero"
            style={{
              backgroundImage: `linear-gradient(90deg, rgba(255,255,255,.94), rgba(255,255,255,.30)), url(${landscape})`,
            }}
          >
            <span className="sample-eyebrow">☼ &nbsp; GOOD MORNING, TAYLOR</span>
            <h1>Welcome back to AYRA</h1>
            <p>
              Your unified AI workspace for research, execution, and creation.
              <br />
              Here’s what’s happening across your work.
            </p>
            <span className="sample-hero-quote">
              “Ideas to outcomes,
              <br /> all in one place.”
            </span>
          </section>
          <div className="sample-metrics">
            {metrics.map(({ value, label, detail, Icon, tone }) => (
              <button
                key={label}
                className={`sample-metric tone-${tone}`}
                onClick={() =>
                  onNavigate(
                    label === 'Active projects'
                      ? 'Projects'
                      : label === 'Pending approvals'
                        ? 'Activity'
                        : 'Work',
                  )
                }
              >
                <Icon size={22} />
                <strong>{value}</strong>
                <span>{label}</span>
                <small>{detail}</small>
              </button>
            ))}
          </div>
          <section className="sample-panel">
            <SectionTitle onSeeAll={() => onNavigate('Work')}>Continue Working</SectionTitle>
            <div className="sample-working-grid">
              {working.map((item) => (
                <button
                  className="sample-working"
                  key={item.title}
                  onClick={() => onNavigate(item.target)}
                >
                  <span className={`sample-icon tone-${item.tone}`}>
                    {item.target === 'Chat' ? (
                      <Globe size={20} />
                    ) : item.target === 'Work' ? (
                      <FileText size={20} />
                    ) : (
                      <Code size={20} />
                    )}
                  </span>
                  <small className="sample-eyebrow">{item.label}</small>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <div className="sample-progress">
                    <span style={{ width: `${item.progress}%` }} />
                  </div>
                  <small>{item.progress}% · Updated recently</small>
                </button>
              ))}
            </div>
          </section>
          <section className="sample-panel">
            <SectionTitle onSeeAll={() => onNavigate('Projects')}>Recent Projects</SectionTitle>
            <div className="sample-project-grid">
              {projectSamples.map((project) => (
                <button
                  key={project.title}
                  className="sample-project-card"
                  onClick={() => onNavigate('Projects')}
                >
                  <span className={`sample-icon tone-${project.tone}`}>
                    <Folder size={20} />
                  </span>
                  <h3>{project.title}</h3>
                  <small>{project.area}</small>
                  <p>{project.description}</p>
                  <span className="sample-status">{project.status}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
        <div className="sample-home-rail">
          <section className="sample-panel sample-focus">
            <span className="sample-focus-title">
              <Target size={22} /> Today’s Focus
            </span>
            <h2>Finalize the Q2 strategy report</h2>
            <p>You’re 40% complete. Review the market analysis and finish the executive summary.</p>
            <button className="sample-primary" onClick={() => onNavigate('Work')}>
              Continue working <ArrowRight size={16} />
            </button>
            <div className="sample-suggestions">
              <small>Other suggestions</small>
              <button onClick={() => onNavigate('Activity')}>
                <CheckCircle size={18} /> Review approvals
              </button>
              <button onClick={() => onNavigate('Build')}>
                <Code size={18} /> Check the portal build
              </button>
              <button onClick={() => onNavigate('Projects')}>
                <Calendar size={18} /> Prepare stakeholder call
              </button>
            </div>
          </section>
          <section className="sample-panel">
            <SectionTitle onSeeAll={() => onNavigate('Activity')}>Recent Activity</SectionTitle>
            {[
              { title: 'Research task updated', ago: '2h ago', Icon: Globe },
              { title: 'Q2 Strategy Report', ago: '4h ago', Icon: FileText },
              { title: 'Build in progress', ago: '5h ago', Icon: Code },
              { title: 'Approval received', ago: '8h ago', Icon: CheckCircle },
            ].map(({ title, ago, Icon }) => (
              <button
                key={String(title)}
                className="sample-activity"
                onClick={() => onNavigate('Activity')}
              >
                <span className="sample-icon tone-blue">
                  <Icon size={18} />
                </span>
                <span>
                  {String(title)}
                  <small>Sample update</small>
                </span>
                <time>{String(ago)}</time>
              </button>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
