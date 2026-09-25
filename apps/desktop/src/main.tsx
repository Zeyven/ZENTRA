import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FoundationView, SurfaceIcon, surfaces, type Surface } from '@ayra/ui';
import {
  readLocalDraft,
  writeLocalDraft,
  type DraftStorage,
  type DraftSurface,
  type LocalDraft,
} from '@ayra/ui/local-drafts';
import {
  MAX_CHAT_NOTES,
  readLocalChatNotes,
  writeLocalChatNotes,
  type LocalChatNote,
} from '@ayra/ui/local-chat-notes';
import '@ayra/ui/components.css';
import '@ayra/ui/styles.css';
function current(): Surface {
  return surfaces.find((s) => `#${s.toLowerCase()}` === window.location.hash) ?? 'Home';
}
function App() {
  const [surface, setSurface] = useState(current);
  const [compact, setCompact] = useState(false);
  const [draftStorage] = useState<DraftStorage | null>(() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  });
  const [localDrafts, setLocalDrafts] = useState<Record<DraftSurface, LocalDraft | null>>(() => ({
    Chat: readLocalDraft(draftStorage, 'Chat'),
    Work: readLocalDraft(draftStorage, 'Work'),
  }));
  const [draftSaveAvailable, setDraftSaveAvailable] = useState(Boolean(draftStorage));
  const [chatNotes, setChatNotes] = useState<LocalChatNote[]>(() =>
    readLocalChatNotes(draftStorage),
  );
  const [chatNotesSaveAvailable, setChatNotesSaveAvailable] = useState(Boolean(draftStorage));
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
      localDrafts={localDrafts}
      draftSaveAvailable={draftSaveAvailable}
      chatNotes={chatNotes}
      chatNotesSaveAvailable={chatNotesSaveAvailable}
      onChatNoteSave={(text) => {
        const note: LocalChatNote = { id: crypto.randomUUID(), text, createdAt: Date.now() };
        if (chatNotes.length >= MAX_CHAT_NOTES) return false;
        const next = [...chatNotes, note];
        setChatNotes(next);
        const persisted = writeLocalChatNotes(draftStorage, next);
        setChatNotesSaveAvailable(persisted);
        const updatedAt = Date.now();
        setLocalDrafts((currentDrafts) => ({ ...currentDrafts, Chat: null }));
        setDraftSaveAvailable(writeLocalDraft(draftStorage, 'Chat', '', updatedAt));
        return persisted;
      }}
      onChatNoteDelete={(id) => {
        const next = chatNotes.filter((note) => note.id !== id);
        setChatNotes(next);
        const persisted = writeLocalChatNotes(draftStorage, next);
        setChatNotesSaveAvailable(persisted);
        return persisted;
      }}
      onDraftChange={(kind, text) => {
        const updatedAt = Date.now();
        setLocalDrafts((currentDrafts) => ({
          ...currentDrafts,
          [kind]: text ? { text, updatedAt } : null,
        }));
        setDraftSaveAvailable(writeLocalDraft(draftStorage, kind, text, updatedAt));
      }}
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
