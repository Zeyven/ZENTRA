import { describe, expect, it } from 'vitest';
import {
  MAX_LOCAL_PROJECTS,
  MAX_LOCAL_PROJECT_TASKS,
  readLocalProjects,
  writeLocalProjects,
} from './local-projects';

const project = {
  id: 'project-1',
  name: 'Q2 strategy',
  description: 'Draft a plan',
  area: 'Work' as const,
  createdAt: 100,
  tasks: [] as Array<{ id: string; title: string; done: boolean; createdAt: number }>,
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
    const task = { id: 'task-1', title: 'Review sources', done: true, createdAt: 101 };
    expect(writeLocalProjects(storage, [{ ...project, tasks: [task] }])).toBe(true);
    expect(readLocalProjects(storage)[0]?.tasks).toEqual([task]);
    values.set('ayra-local-projects-v1', JSON.stringify([{ ...project, tasks: undefined }]));
    expect(readLocalProjects(storage)).toEqual([project]);
    values.set(
      'ayra-local-projects-v1',
      JSON.stringify([{ ...project, tasks: [{ ...task, done: 'yes' }] }]),
    );
    expect(readLocalProjects(storage)[0]?.tasks).toEqual([]);
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
    expect(
      writeLocalProjects(storage, [
        {
          ...project,
          tasks: Array(MAX_LOCAL_PROJECT_TASKS + 1).fill({
            id: 'task',
            title: 'Too many',
            done: false,
            createdAt: 1,
          }),
        },
      ]),
    ).toBe(false);
  });
});
