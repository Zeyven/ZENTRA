import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FoundationView, SurfaceIcon, surfaces, type Surface } from '@ayra/ui';
import '@ayra/ui/components.css';
import '@ayra/ui/styles.css';
function current(): Surface {
  return surfaces.find((s) => `#${s.toLowerCase()}` === window.location.hash) ?? 'Home';
}
function App() {
  const [surface, setSurface] = useState(current);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const update = () => setSurface(current());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return (
    <FoundationView
      key={surface}
      surface={surface}
      compact={compact}
      onCompactChange={setCompact}
      onNavigate={(next) => {
        window.location.hash = next.toLowerCase();
      }}
      secondaryNavigation={
        <a href="#settings" aria-current={surface === 'Settings' ? 'page' : undefined}>
          <SurfaceIcon surface="Settings" />
          Settings
        </a>
      }
      navigation={surfaces
        .filter((s) => s !== 'Settings')
        .map((s) => (
          <a key={s} href={`#${s.toLowerCase()}`} aria-current={surface === s ? 'page' : undefined}>
            <SurfaceIcon surface={s} />
            {s}
          </a>
        ))}
    />
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<App />);
