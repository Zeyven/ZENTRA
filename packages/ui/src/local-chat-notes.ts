import type { DraftStorage } from './local-drafts';

export type LocalChatNote = {
  id: string;
  text: string;
  createdAt: number;
};

export const MAX_CHAT_NOTE_LENGTH = 20_000;
export const MAX_CHAT_NOTES = 100;
const storageKey = 'ayra:local-chat-notes:v1';

function validNote(value: unknown): value is LocalChatNote {
  if (!value || typeof value !== 'object') return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(note.id) &&
    typeof note.text === 'string' &&
    note.text.trim().length > 0 &&
    note.text.length <= MAX_CHAT_NOTE_LENGTH &&
    typeof note.createdAt === 'number' &&
    Number.isFinite(note.createdAt) &&
    note.createdAt > 0
  );
}

export function readLocalChatNotes(storage: DraftStorage | null): LocalChatNote[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    if (
      record.version !== 1 ||
      !Array.isArray(record.notes) ||
      record.notes.length > MAX_CHAT_NOTES ||
      !record.notes.every(validNote)
    )
      return [];
    return record.notes;
  } catch {
    return [];
  }
}

export function writeLocalChatNotes(storage: DraftStorage | null, notes: LocalChatNote[]): boolean {
  if (!storage || notes.length > MAX_CHAT_NOTES || !notes.every(validNote)) return false;
  try {
    if (notes.length === 0) storage.removeItem(storageKey);
    else storage.setItem(storageKey, JSON.stringify({ version: 1, notes }));
    return true;
  } catch {
    return false;
  }
}
