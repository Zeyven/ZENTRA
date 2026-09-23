export type DraftSurface = 'Chat' | 'Work';

export type LocalDraft = {
  text: string;
  updatedAt: number;
};

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const MAX_DRAFT_LENGTH = 50_000;

const keyFor = (surface: DraftSurface) => `ayra:local-draft:v1:${surface.toLowerCase()}`;

export function readLocalDraft(
  storage: DraftStorage | null,
  surface: DraftSurface,
): LocalDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(keyFor(surface));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (
      record.version !== 1 ||
      typeof record.text !== 'string' ||
      record.text.length > MAX_DRAFT_LENGTH ||
      typeof record.updatedAt !== 'number' ||
      !Number.isFinite(record.updatedAt)
    )
      return null;
    return { text: record.text, updatedAt: record.updatedAt };
  } catch {
    return null;
  }
}

export function writeLocalDraft(
  storage: DraftStorage | null,
  surface: DraftSurface,
  text: string,
  updatedAt: number,
): boolean {
  if (!storage || text.length > MAX_DRAFT_LENGTH || !Number.isFinite(updatedAt)) return false;
  try {
    if (text.length === 0) storage.removeItem(keyFor(surface));
    else storage.setItem(keyFor(surface), JSON.stringify({ version: 1, text, updatedAt }));
    return true;
  } catch {
    return false;
  }
}
