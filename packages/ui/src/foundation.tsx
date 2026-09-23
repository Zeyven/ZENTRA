'use client';
import { useState, useEffect, type ReactNode } from 'react';
import { CommandBar } from './components/command-bar';
import { Sidebar, Card, TaskCard, ArtifactCard, ProjectCard } from './components/primitives';
import {
  House,
  ChatCircle,
  Briefcase,
  Code,
  Folder,
  GearSix,
  Bell,
  CaretDown,
  ArrowRight,
  Plus,
  FileText,
  Target,
  Clock,
  Sun,
  PaperPlaneTilt,
  SidebarSimple,
  ListBullets,
  Info,
  Stack,
  GitBranch,
  Terminal,
  TestTube,
  Eye,
  Files,
} from '@phosphor-icons/react';
export const surfaces = [
  'Home',
  'Chat',
  'Work',
  'Build',
  'Projects',
  'Activity',
  'Settings',
] as const;
export type Surface = (typeof surfaces)[number];
const icons = {
  Home: House,
  Chat: ChatCircle,
  Work: Briefcase,
  Build: Code,
  Projects: Folder,
  Activity: Clock,
  Settings: GearSix,
};
export function SurfaceIcon({ surface }: { surface: Surface }) {
  const Icon = icons[surface];
  return <Icon size={21} weight="regular" aria-hidden="true" />;
}
const descriptions = {
  Chat: 'A little curiosity. A new possibility.',
  Work: 'Make room for your next great idea.',
  Build: 'From an idea to something you can use.',
  Projects: 'A home for everything you’re working on.',
  Activity: 'A clear view of what’s happening.',
  Settings: 'Make this space feel like yours.',
};
function Empty({
  icon = 'Work',
  title,
  children,
}: {
  icon?: Surface;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">
        <SurfaceIcon surface={icon} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Panel({
  title,
  icon,
  children,
  className = '',
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`panel ${className}`}>
      <div className="panel-title">
        <h2>
          {icon}
          {title}
        </h2>
      </div>
      {children}
    </Card>
  );
}
export function FoundationView({
  surface = 'Home',
  navigation,
  secondaryNavigation,
  onNavigate,
  compact,
  onCompactChange,
}: {
  surface?: Surface;
  navigation: ReactNode;
  secondaryNavigation: ReactNode;
  onNavigate: (surface: Surface) => void;
  compact: boolean;
  onCompactChange: (value: boolean) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
        setNotice('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [menu, setMenu] = useState<'workspace' | 'notifications' | 'account' | null>(null);
  const [draft, setDraft] = useState('');
  const [buildTab, setBuildTab] = useState('Preview');
  const [projectTab, setProjectTab] = useState('Overview');
  const [activityFilter, setActivityFilter] = useState('All');
  const [workTab, setWorkTab] = useState('Sources');
  const [notice, setNotice] = useState('');
  const [contextOpen, setContextOpen] = useState(true);
  const toggle = (value: typeof menu) => setMenu(menu === value ? null : value);
  const navigate = onNavigate;
  const unavailable = () =>
    setNotice('账户与任务服务尚未开放。内容仍保留在当前页面，没有发送到模型。');
  return (
    <div className={`shell ${compact ? 'compact' : ''}`}>
      <a
        className="skip"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        跳到主要内容
      </a>
      <Sidebar>
        <div className="wordmark">
          <span className="brand-symbol" role="img" aria-label="AYRA 标识" />
          <span>AYRA</span>
        </div>
        <nav aria-label="主要导航">{navigation}</nav>
        <nav className="secondary-navigation" aria-label="设置">
          {secondaryNavigation}
        </nav>
        <div className="sidebar-story">
          <div className="landscape" />
          <p>
            One workspace
            <br />
            for deeper work.
          </p>
          <span>
            Chat. Work. Build.
            <br />
            All together.
          </span>
        </div>
      </Sidebar>
      <div className="app-body">
        <header className="topbar">
          <button
            className="workspace-switch"
            onClick={() => toggle('workspace')}
            aria-expanded={menu === 'workspace'}
          >
            <span className="brand-symbol small" />
            Personal workspace
            <CaretDown size={14} />
          </button>
          <CommandBar
            items={surfaces}
            onSelect={(value) => {
              const next = surfaces.find((s) => s === value);
              if (next) navigate(next);
            }}
          />
          <div className="topbar-actions">
            <button
              className="icon-button"
              aria-label="通知"
              onClick={() => toggle('notifications')}
            >
              <Bell size={21} />
            </button>
            <button
              className="account-button"
              aria-label="账户与个人资料"
              aria-expanded={menu === 'account'}
              onClick={() => toggle('account')}
            >
              <span className="account-avatar">
                <SurfaceIcon surface="Home" />
              </span>
              <span>
                Guest<span className="muted account-caption">Local preview</span>
              </span>
              <CaretDown size={14} />
            </button>
          </div>
          {menu && (
            <div className={`top-popover ${menu}`}>
              <strong>
                {menu === 'workspace'
                  ? 'Personal workspace'
                  : menu === 'notifications'
                    ? 'Notifications'
                    : 'Guest preview'}
              </strong>
              <p>
                {menu === 'workspace'
                  ? '工作区服务尚未连接。当前为本地界面预览。'
                  : menu === 'notifications'
                    ? '暂无通知。账户连接后，更新会显示在这里。'
                    : '身份服务尚未开放，当前未登录。'}
              </p>
              <button onClick={() => setMenu(null)}>Close</button>
            </div>
          )}
        </header>
        <main id="main" tabIndex={-1}>
          {surface === 'Home' ? (
            <div className="home-grid">
              <div className="home-primary">
                <section className="hero">
                  <div className="hero-copy">
                    <p className="eyebrow">
                      <Sun size={21} /> A LITTLE SPACE TO THINK BIG
                    </p>
                    <h1>Welcome to AYRA</h1>
                    <p>
                      Your unified AI workspace for research, execution, and creation.
                      <br />
                      Bring your ideas together. Make room for what’s next.
                    </p>
                  </div>
                </section>
                <Panel title="Continue Working">
                  <div className="working-grid">
                    {(['Chat', 'Work', 'Build'] as const).map((s, i) => (
                      <button className="work-card" key={s} onClick={() => navigate(s)}>
                        <span className={`metric-icon tint-${i}`}>
                          <SurfaceIcon surface={s} />
                        </span>
                        <span className="eyebrow">{['EXPLORE', 'CREATE', 'BUILD'][i]}</span>
                        <h3>
                          {
                            [
                              'Start with a question',
                              'Give your ideas a shape',
                              'Build something new',
                            ][i]
                          }
                        </h3>
                        <p>
                          {
                            [
                              'A place to think things through.',
                              'Documents, research, and clear outcomes.',
                              'Your next project starts with a possibility.',
                            ][i]
                          }
                        </p>
                        <span className="card-link">
                          Open {s}
                          <ArrowRight size={16} />
                        </span>
                      </button>
                    ))}
                  </div>
                </Panel>
                <Panel title="Recent Projects">
                  <Empty icon="Projects" title="A fresh start for your projects">
                    项目服务连接后，你的项目会显示在这里。
                  </Empty>
                </Panel>
              </div>
              <div className="home-rail">
                <Panel title="Today’s Focus" icon={<Target size={25} />} className="focus-panel">
                  <h3>
                    Good work starts
                    <br />
                    with a little clarity.
                  </h3>
                  <p>
                    One question. One idea. One next step.
                    <br />
                    Find the space to make it happen.
                  </p>
                  <button className="primary" onClick={() => navigate('Chat')}>
                    Explore your workspace
                    <ArrowRight size={17} />
                  </button>
                  <div className="suggestions">
                    <small>Make yourself at home</small>
                    {(['Chat', 'Work', 'Build'] as const).map((s) => (
                      <button key={s} onClick={() => navigate(s)}>
                        <SurfaceIcon surface={s} />
                        {s === 'Chat'
                          ? 'Think through an idea'
                          : s === 'Work'
                            ? 'Explore your workbench'
                            : 'Open your build space'}
                        <ArrowRight size={14} />
                      </button>
                    ))}
                  </div>
                </Panel>
                <Panel title="Recent Activity">
                  <Empty icon="Home" title="A quiet beginning">
                    任务、成果和审批的更新会汇集于此。
                  </Empty>
                </Panel>
              </div>
            </div>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <p className="breadcrumb">
                    Workspace <span>/</span> {surface}
                  </p>
                  <h1>
                    {surface === 'Chat'
                      ? 'A conversation starts here'
                      : surface === 'Work'
                        ? 'Your work, thoughtfully crafted'
                        : surface === 'Build'
                          ? 'Your next build'
                          : surface === 'Projects'
                            ? 'Project workspace'
                            : surface === 'Activity'
                              ? 'Your activity'
                              : 'Your workspace'}
                  </h1>
                  <p>{descriptions[surface]}</p>
                </div>
                <div className="page-actions">
                  {(surface === 'Chat' || surface === 'Work') && (
                    <button
                      className="subtle"
                      aria-pressed={contextOpen}
                      onClick={() => setContextOpen(!contextOpen)}
                    >
                      <SidebarSimple size={18} />
                      {contextOpen ? 'Hide context' : 'Show context'}
                    </button>
                  )}
                  <span className="preview-tag">Local preview</span>
                </div>
              </div>
              {surface === 'Chat' ? (
                <div className={`chat-layout ${contextOpen ? '' : 'context-collapsed'}`}>
                  <section className="chat-main panel">
                    <div className="conversation-heading">
                      <Sun size={22} />
                      New conversation
                    </div>
                    <div className="chat-welcome">
                      <span className="brand-symbol" />
                      <h2>What’s on your mind?</h2>
                      <p>
                        A question, a rough idea, a new direction.
                        <br />
                        Start wherever you are.
                      </p>
                      <div className="prompt-grid">
                        {[
                          'Help me explore an idea',
                          'Outline a research plan',
                          'Think through a challenge',
                        ].map((p) => (
                          <button key={p} onClick={() => setDraft(p)}>
                            {p}
                            <ArrowRight size={16} />
                          </button>
                        ))}
                      </div>
                    </div>
                    <form
                      className="composer"
                      onSubmit={(e) => {
                        e.preventDefault();
                        unavailable();
                      }}
                    >
                      <textarea
                        aria-label="消息草稿"
                        placeholder="Ask AYRA anything…"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                      <div>
                        <span className="muted">草稿仅保留在当前页面</span>
                        <button
                          className="primary icon-button"
                          aria-label="发送消息"
                          disabled={!draft.trim()}
                        >
                          <PaperPlaneTilt size={20} />
                        </button>
                      </div>
                    </form>
                  </section>
                  <div className="context-rail">
                    <Panel title="Context" icon={<Stack size={21} />}>
                      <h3>Linked Project</h3>
                      <Empty icon="Projects" title="No project linked">
                        项目连接后，可在对话中使用它的上下文。
                      </Empty>
                      <h3>Connected Resources</h3>
                      <Empty title="No resources yet">文件与知识资源将在这里汇集。</Empty>
                    </Panel>
                    <Panel title="Generated in this chat" icon={<FileText size={20} />}>
                      <p className="muted padded">生成的文档与成果会显示在这里。</p>
                    </Panel>
                  </div>
                </div>
              ) : surface === 'Work' ? (
                <div className={`work-layout ${contextOpen ? '' : 'context-collapsed'}`}>
                  <Panel title="Outline" icon={<ListBullets size={19} />}>
                    <p className="muted padded">文档创建后，章节会显示在这里。</p>
                    <button
                      className="subtle full"
                      onClick={() => setNotice('文档服务尚未开放。你可以先在中央编辑区整理草稿。')}
                    >
                      <Plus size={16} />
                      Add section
                    </button>
                  </Panel>
                  <section className="document panel">
                    <div className="editor-toolbar">
                      <span>Draft notes</span>
                      <span className="muted">当前页面草稿</span>
                    </div>
                    <div className="document-paper">
                      <p className="eyebrow">A NEW BEGINNING</p>
                      <h2>
                        Great work starts
                        <br />
                        with a first thought.
                      </h2>
                      <textarea
                        aria-label="文档草稿"
                        placeholder="Give your idea a little room. Start writing here…"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                    </div>
                  </section>
                  <Panel title="Workspace context">
                    <div className="tabs">
                      {['Sources', 'Insights', 'Artifacts'].map((t) => (
                        <button aria-pressed={t === workTab} key={t} onClick={() => setWorkTab(t)}>
                          {t}
                        </button>
                      ))}
                    </div>
                    <Empty title={`No ${workTab.toLowerCase()} yet`}>
                      连接资源并开始任务后，相关内容会显示在这里。
                    </Empty>
                  </Panel>
                </div>
              ) : surface === 'Build' ? (
                <>
                  <div className="build-tabs tabs">
                    {[
                      { name: 'Preview', Icon: Eye },
                      { name: 'Code', Icon: Code },
                      { name: 'Plan', Icon: FileText },
                      { name: 'Diff', Icon: GitBranch },
                      { name: 'Tests', Icon: TestTube },
                      { name: 'Logs', Icon: Terminal },
                    ].map(({ name, Icon }) => (
                      <button
                        aria-pressed={buildTab === name}
                        onClick={() => setBuildTab(name)}
                        key={name}
                      >
                        <Icon size={18} />
                        {name}
                      </button>
                    ))}
                  </div>
                  <div className="build-layout">
                    <Panel title="Files" icon={<Files size={20} />}>
                      <Empty icon="Projects" title="No repository">
                        连接项目后查看文件。
                      </Empty>
                    </Panel>
                    <Panel title={buildTab}>
                      <Empty
                        icon="Build"
                        title={
                          buildTab === 'Code'
                            ? 'A clean canvas for your next build'
                            : `No ${buildTab.toLowerCase()} yet`
                        }
                      >
                        {buildTab === 'Tests'
                          ? '尚未运行项目测试。'
                          : buildTab === 'Logs'
                            ? '尚无执行日志。'
                            : '构建服务接入后，项目内容会显示在这里。'}
                      </Empty>
                    </Panel>
                    <Panel title="AYRA" icon={<span className="brand-symbol small" />}>
                      <span className="status-pill">Not connected</span>
                      <p className="muted padded">
                        任务开始后，可以在这里查看进度、审批与执行证据。
                      </p>
                      <ol className="agent-steps">
                        {['Goal', 'Progress', 'Result'].map((s) => (
                          <li key={s}>
                            <Clock size={18} />
                            <span>
                              {s}
                              <small>Waiting for a task</small>
                            </span>
                          </li>
                        ))}
                      </ol>
                    </Panel>
                  </div>
                </>
              ) : surface === 'Projects' ? (
                <div className="project-workspace">
                  <div className="tabs" aria-label="Project sections">
                    {['Overview', 'Resources', 'Tasks', 'Artifacts'].map((tab) => (
                      <button
                        key={tab}
                        aria-pressed={projectTab === tab}
                        onClick={() => setProjectTab(tab)}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                  {projectTab === 'Overview' ? (
                    <div className="project-overview">
                      <ProjectCard
                        title="A home for your next idea"
                        description="Keep the goal, resources, and outcomes together."
                      >
                        <p>项目服务尚未连接。这里将展示你选择的项目，不会创建演示项目。</p>
                        <button className="primary" onClick={unavailable}>
                          <Plus size={16} />
                          Create project
                        </button>
                      </ProjectCard>
                      <TaskCard title="Start with a clear goal" status="Not connected">
                        <p>项目创建后，目标与下一步会显示在这里。</p>
                      </TaskCard>
                    </div>
                  ) : projectTab === 'Artifacts' ? (
                    <ArtifactCard title="Your project’s outcomes" kind="No artifacts yet">
                      <p>生成的文档、报告与软件成果将在这里汇集。</p>
                    </ArtifactCard>
                  ) : (
                    <Panel title={projectTab}>
                      <Empty icon="Projects" title={`No ${projectTab.toLowerCase()} yet`}>
                        连接项目服务后，在这里管理项目{projectTab === 'Tasks' ? '任务' : '资源'}。
                      </Empty>
                    </Panel>
                  )}
                </div>
              ) : surface === 'Activity' ? (
                <Panel title="Workspace activity">
                  <div className="tabs" aria-label="Activity filters">
                    {['All', 'Tasks', 'Artifacts', 'Approvals'].map((filter) => (
                      <button
                        key={filter}
                        aria-pressed={activityFilter === filter}
                        onClick={() => setActivityFilter(filter)}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                  <Empty
                    icon="Activity"
                    title={
                      activityFilter === 'All'
                        ? 'Nothing to catch up on'
                        : `No ${activityFilter.toLowerCase()} yet`
                    }
                  >
                    连接工作区后，任务进度、成果与待审批事项会汇集在这里。
                  </Empty>
                </Panel>
              ) : (
                <Panel title="Appearance">
                  <div className="setting-row">
                    <div>
                      <h3>Compact navigation</h3>
                      <p className="muted">收起侧栏中的装饰区域，为导航留出更多空间。</p>
                    </div>
                    <button
                      className="subtle"
                      aria-pressed={compact}
                      onClick={() => onCompactChange(!compact)}
                    >
                      <SidebarSimple size={18} />
                      {compact ? 'Compact' : 'Comfortable'}
                    </button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <h3>Account & workspace</h3>
                      <p className="muted">身份和工作区服务尚未连接。</p>
                    </div>
                    <span className="preview-tag">Not connected</span>
                  </div>
                </Panel>
              )}
            </>
          )}
          <footer>
            <span>AYRA · A little more possibility.</span>
            <span>界面预览 · 账户与任务服务尚未连接</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div role="status" className="toast">
          <Info size={20} />
          {notice}
          <button onClick={() => setNotice('')} aria-label="关闭提示">
            Close
          </button>
        </div>
      )}
    </div>
  );
}
