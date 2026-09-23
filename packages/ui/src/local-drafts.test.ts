import { describe, expect, it } from 'vitest';
import {
  MAX_DRAFT_LENGTH,
  readLocalDraft,
  writeLocalDraft,
  type DraftStorage,
} from './local-drafts';

function memoryStorage(): DraftStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe('device-local drafts', () => {
  it('keeps Chat and Work drafts separate and can remove one without touching the other', () => {
    const storage = memoryStorage();
    expect(writeLocalDraft(storage, 'Chat', 'A question', 100)).toBe(true);
    expect(writeLocalDraft(storage, 'Work', 'A report', 200)).toBe(true);
    expect(readLocalDraft(storage, 'Chat')).toEqual({ text: 'A question', updatedAt: 100 });
    expect(readLocalDraft(storage, 'Work')).toEqual({ text: 'A report', updatedAt: 200 });
    expect(writeLocalDraft(storage, 'Chat', '', 300)).toBe(true);
    expect(readLocalDraft(storage, 'Chat')).toBeNull();
    expect(readLocalDraft(storage, 'Work')?.text).toBe('A report');
  });

  it('rejects oversized and invalid saved data without exposing it as a draft', () => {
    const storage = memoryStorage();
    expect(writeLocalDraft(storage, 'Chat', 'x'.repeat(MAX_DRAFT_LENGTH + 1), 100)).toBe(false);
    storage.setItem('ayra:local-draft:v1:chat', '{malformed');
    expect(readLocalDraft(storage, 'Chat')).toBeNull();
    storage.setItem(
      'ayra:local-draft:v1:chat',
      JSON.stringify({ version: 2, text: 'old', updatedAt: 100 }),
    );
    expect(readLocalDraft(storage, 'Chat')).toBeNull();
  });

  it('reports storage failure so the UI never claims a draft was saved', () => {
    const storage: DraftStorage = {
      getItem: () => {
        throw new Error('disabled');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('disabled');
      },
    };
    expect(readLocalDraft(storage, 'Work')).toBeNull();
    expect(writeLocalDraft(storage, 'Work', 'Important text', 100)).toBe(false);
    expect(writeLocalDraft(null, 'Work', 'Important text', 100)).toBe(false);
  });
});
