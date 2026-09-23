import type { Metadata } from 'next';
import { Icon } from '@ayra/ui/icons';
import { DownloadSection, ProductImage } from '../../components/shared';
export const metadata: Metadata = {
  title: 'Product',
  description: 'Meet AYRA Desktop: a connected place to think, create, and build.',
};
export default function Product() {
  return (
    <>
      <section className="page-intro container">
        <span className="eyebrow">MEET AYRA DESKTOP</span>
        <h1>
          Less switching.
          <br />
          More meaningful work.
        </h1>
        <p>One place for your questions, your projects, and the things you make.</p>
        <p className="release-note">A preview of the product we’re building.</p>
      </section>
      <div className="product-wide container">
        <ProductImage />
      </div>
      <section className="section container product-stories">
        {[
          {
            id: 'chat',
            title: 'Think with AI.',
            text: 'Start with a question or a half-formed idea. Bring the context that matters and explore where it leads.',
            detail: 'Conversation · Context · Artifacts',
            num: '01',
          },
          {
            id: 'work',
            title: 'Turn ideas into outcomes.',
            text: 'Give your research and thinking a useful form. Work brings documents, resources, and insights into one focused space.',
            detail: 'Document · Research · Resources · Insights',
            num: '02',
          },
          {
            id: 'build',
            title: 'Create software with AI.',
            text: 'Move from a clear goal to changes you can understand. Follow progress, inspect the result, and decide what happens next.',
            detail: 'Repository · Changes · Tests · Preview',
            num: '03',
          },
        ].map((s) => (
          <article className="product-story" id={s.id} key={s.id}>
            <div className="story-label">
              <span>{s.num}</span>
              <Icon name={s.id as 'chat' | 'work' | 'build'} size={28} />
              <h2>{s.id[0]!.toUpperCase() + s.id.slice(1)}</h2>
            </div>
            <div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <span className="story-detail">{s.detail}</span>
            </div>
          </article>
        ))}
      </section>
      <section className="project-promise container">
        <span className="eyebrow">CONTEXT THAT CONTINUES</span>
        <h2>Your project is the thread.</h2>
        <p>
          Keep the goal, resources, tasks, and outcomes together.
          <br />
          Return to your work with a clear sense of where you left off.
        </p>
      </section>
      <DownloadSection />
    </>
  );
}
