import type { ReactNode } from 'react';
export const surfaces = ['Home', 'Chat', 'Work', 'Build', 'Projects', 'Settings'] as const;
export type Surface = (typeof surfaces)[number];
const copy: Record<Surface, [string, string]> = {
  Home: ['把想法，变成完成的工作。', '在一个工作空间里提问、研究、创作和构建。'],
  Chat: ['从一个问题开始', '问答、分析与文件理解。'],
  Work: ['让工作有可用的成果', '文档、研究、数据与演示。'],
  Build: ['从目标到可运行的软件', '围绕项目完成修改、测试、审阅与交付。'],
  Projects: ['为长期工作保留上下文', '项目组织任务、资源与成果。'],
  Settings: ['你的工作空间', '账户、权限与偏好。'],
};
export function FoundationView({
  surface = 'Home',
  navigation,
  secondaryNavigation,
}: {
  surface?: Surface;
  navigation: ReactNode;
  secondaryNavigation: ReactNode;
}) {
  return (
    <div className="shell">
      <a className="skip" href="#main">
        跳到主要内容
      </a>
      <aside>
        <div className="wordmark">
          AYRA<span>工作空间</span>
        </div>
        <nav aria-label="主要导航">{navigation}</nav>
        <nav className="secondary-navigation" aria-label="设置">
          {secondaryNavigation}
        </nav>
        <p className="foundation-label">开发预览</p>
      </aside>
      <main id="main" tabIndex={-1}>
        <header>
          <span>{surface}</span>
          <span>AYRA</span>
        </header>
        <section className="intro">
          <p className="eyebrow">你的通用智能体工作空间</p>
          <h1>{copy[surface][0]}</h1>
          <p>{copy[surface][1]}</p>
        </section>
        <section className="empty" aria-labelledby="empty-title">
          <div className="empty-icon" aria-hidden="true">
            A
          </div>
          <h2 id="empty-title">工作空间正在准备中</h2>
          <p>此版本用于验证应用基础。账户与任务功能尚未开放。</p>
          <p>接入后，你可以在这里继续工作、处理待办并查看成果。</p>
        </section>
        <footer>AYRA · Working Brand</footer>
      </main>
    </div>
  );
}
