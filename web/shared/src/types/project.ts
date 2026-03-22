/**
 * A configured project (repository) that Kanban tracks.
 *
 * Swift source: Sources/KanbanCodeCore/Domain/Entities/Project.swift
 * Spec: Section 7.7 (Settings Schema)
 */

export interface Project {
  path: string;
  name: string;
  repoRoot?: string | null;
  visible: boolean;
  githubFilter?: string | null;
  promptTemplate?: string | null;
  githubIssuePromptTemplate?: string | null;
}

/** The effective git repository root (repoRoot if set, otherwise path). */
export function getEffectiveRepoRoot(project: Project): string {
  return project.repoRoot ?? project.path;
}

/** Create a project with name defaulting to last path component. */
export function createProject(projectPath: string, overrides: Partial<Omit<Project, 'path'>> = {}): Project {
  return {
    path: projectPath,
    name: overrides.name ?? projectPath.split('/').filter(Boolean).pop() ?? projectPath,
    visible: true,
    ...overrides,
  };
}
