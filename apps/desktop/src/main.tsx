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
import {
  MAX_LOCAL_PROJECTS,
  MAX_LOCAL_PROJECT_TASKS,
  readLocalProjects,
  writeLocalProjects,
  type LocalProject,
} from '@ayra/ui/local-projects';
import '@ayra/ui/components.css';
import '@ayra/ui/styles.css';
function current(): Surface {
  return surfaces.find((s) => `#${s.toLowerCase()}` === window.location.hash) ?? 'Home';
}
function App() {
  const [surface, setSurface] = useState(current);
  const [compact, setCompact] = useState(false);
  const [sampleMode, setSampleMode] = useState(() => {
    try {
      return window.localStorage.getItem('ayra-workspace-mode') !== 'personal';
    } catch {
      return true;
    }
  });
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
  const [localProjects, setLocalProjects] = useState<LocalProject[]>(() =>
    readLocalProjects(draftStorage),
  );
  const [projectsSaveAvailable, setProjectsSaveAvailable] = useState(Boolean(draftStorage));
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const saveProjects = (next: LocalProject[]) => {
    setLocalProjects(next);
    const saved = writeLocalProjects(draftStorage, next);
    setProjectsSaveAvailable(saved);
    return saved;
  };
  useEffect(() => {
    const update = () => setSurface(current());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem('ayra-workspace-mode', sampleMode ? 'sample' : 'personal');
    } catch {
      // The workspace switch still works for this session when storage is unavailable.
    }
  }, [sampleMode]);
  return (
    <FoundationView
      key={surface}
      surface={surface}
      compact={compact}
      onCompactChange={setCompact}
      sampleMode={sampleMode}
      onSampleModeChange={setSampleMode}
      localDrafts={localDrafts}
      draftSaveAvailable={draftSaveAvailable}
      chatNotes={chatNotes}
      chatNotesSaveAvailable={chatNotesSaveAvailable}
      localProjects={localProjects}
      projectsSaveAvailable={projectsSaveAvailable}
      selectedProjectId={selectedProjectId}
      onProjectSelect={setSelectedProjectId}
      onProjectCreate={(name, description, area) => {
        if (localProjects.length >= MAX_LOCAL_PROJECTS) return false;
        const id = crypto.randomUUID();
        const next = [
          { id, name, description, area, createdAt: Date.now(), tasks: [] },
          ...localProjects,
        ];
        setSelectedProjectId(id);
        return saveProjects(next);
      }}
      onProjectTaskAdd={(projectId, title) => {
        const project = localProjects.find((item) => item.id === projectId);
        if (!project || project.tasks.length >= MAX_LOCAL_PROJECT_TASKS) return false;
        const task = { id: crypto.randomUUID(), title, done: false, createdAt: Date.now() };
        return saveProjects(
          localProjects.map((item) =>
            item.id === projectId ? { ...item, tasks: [...item.tasks, task] } : item,
          ),
        );
      }}
      onProjectTaskToggle={(projectId, taskId) => {
        const project = localProjects.find((item) => item.id === projectId);
        if (!project?.tasks.some((task) => task.id === taskId)) return false;
        return saveProjects(
          localProjects.map((item) =>
            item.id === projectId
              ? {
                  ...item,
                  tasks: item.tasks.map((task) =>
                    task.id === taskId ? { ...task, done: !task.done } : task,
                  ),
                }
              : item,
          ),
        );
      }}
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
