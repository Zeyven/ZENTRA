import { describe, expect, it } from 'vitest';
import { MAX_CHAT_NOTES, readLocalChatNotes, writeLocalChatNotes } from './local-chat-notes';
import type { DraftStorage } from './local-drafts';

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

const note = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  text: 'A research idea',
  createdAt: 100,
};

describe('device-local Chat notes', () => {
  it('round trips saved notes and can clear them', () => {
    const storage = memoryStorage();
    expect(writeLocalChatNotes(storage, [note])).toBe(true);
    expect(readLocalChatNotes(storage)).toEqual([note]);
    expect(writeLocalChatNotes(storage, [])).toBe(true);
    expect(readLocalChatNotes(storage)).toEqual([]);
  });

  it('rejects malformed, oversized and version-mismatched data', () => {
    const storage = memoryStorage();
    storage.setItem('ayra:local-chat-notes:v1', '{broken');
    expect(readLocalChatNotes(storage)).toEqual([]);
    storage.setItem('ayra:local-chat-notes:v1', JSON.stringify({ version: 2, notes: [note] }));
    expect(readLocalChatNotes(storage)).toEqual([]);
    storage.setItem(
      'ayra:local-chat-notes:v1',
      JSON.stringify({ version: 1, notes: [{ ...note, text: '' }] }),
    );
    expect(readLocalChatNotes(storage)).toEqual([]);
    expect(writeLocalChatNotes(storage, Array(MAX_CHAT_NOTES + 1).fill(note))).toBe(false);
  });

  it('reports unavailable storage without claiming persistence', () => {
    const denied: DraftStorage = {
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
    expect(readLocalChatNotes(denied)).toEqual([]);
    expect(writeLocalChatNotes(denied, [note])).toBe(false);
    expect(writeLocalChatNotes(null, [note])).toBe(false);
  });
});
