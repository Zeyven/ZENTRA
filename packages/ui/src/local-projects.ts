export type LocalProject = {
  id: string;
  name: string;
  description: string;
  area: 'Work' | 'Build';
  createdAt: number;
};

export type ProjectStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const MAX_LOCAL_PROJECTS = 30;
const KEY = 'ayra-local-projects-v1';

export function readLocalProjects(storage: ProjectStorage | null): LocalProject[] {
  if (!storage) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is LocalProject =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof item.id === 'string' &&
          item.id.length > 0 &&
          typeof item.name === 'string' &&
          item.name.length > 0 &&
          item.name.length <= 100 &&
          typeof item.description === 'string' &&
          item.description.length <= 500 &&
          (item.area === 'Work' || item.area === 'Build') &&
          typeof item.createdAt === 'number' &&
          Number.isFinite(item.createdAt),
      )
      .slice(0, MAX_LOCAL_PROJECTS);
  } catch {
    return [];
  }
}

export function writeLocalProjects(
  storage: ProjectStorage | null,
  projects: LocalProject[],
): boolean {
  if (!storage || projects.length > MAX_LOCAL_PROJECTS) return false;
  try {
    storage.setItem(KEY, JSON.stringify(projects));
    return true;
  } catch {
    return false;
  }
}
