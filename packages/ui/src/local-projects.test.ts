import { describe, expect, it } from 'vitest';
import { MAX_LOCAL_PROJECTS, readLocalProjects, writeLocalProjects } from './local-projects';

const project = {
  id: 'project-1',
  name: 'Q2 strategy',
  description: 'Draft a plan',
  area: 'Work' as const,
  createdAt: 100,
};

describe('device-local projects', () => {
  it('round trips projects and ignores malformed stored data', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    expect(writeLocalProjects(storage, [project])).toBe(true);
    expect(readLocalProjects(storage)).toEqual([project]);
    values.set('ayra-local-projects-v1', JSON.stringify([{ ...project, area: 'Unknown' }]));
    expect(readLocalProjects(storage)).toEqual([]);
    values.set('ayra-local-projects-v1', '{broken');
    expect(readLocalProjects(storage)).toEqual([]);
  });

  it('reports unavailable storage and rejects oversized collections', () => {
    expect(writeLocalProjects(null, [project])).toBe(false);
    expect(readLocalProjects(null)).toEqual([]);
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(writeLocalProjects(storage, [project])).toBe(false);
    expect(writeLocalProjects(storage, Array(MAX_LOCAL_PROJECTS + 1).fill(project))).toBe(false);
  });
});
