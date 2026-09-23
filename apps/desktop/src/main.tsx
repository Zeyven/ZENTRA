import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FoundationView, surfaces, type Surface } from '@ayra/ui';
import '@ayra/ui/styles.css';
function current(): Surface {
  return surfaces.find((s) => `#${s.toLowerCase()}` === window.location.hash) ?? 'Home';
}
function App() {
  const [surface, setSurface] = useState(current);
  useEffect(() => {
    const update = () => setSurface(current());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return (
    <FoundationView
      surface={surface}
      secondaryNavigation={
        <a href="#settings" aria-current={surface === 'Settings' ? 'page' : undefined}>
          Settings
        </a>
      }
      navigation={surfaces
        .filter((s) => s !== 'Settings')
        .map((s) => (
          <a key={s} href={`#${s.toLowerCase()}`} aria-current={surface === s ? 'page' : undefined}>
            {s}
          </a>
        ))}
    />
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<App />);
