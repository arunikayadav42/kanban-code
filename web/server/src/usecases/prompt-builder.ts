import type { Link, Project } from '@kanban-code/shared';
import type { Settings } from '../infrastructure/settings-store.js';

/**
 * Builds the final prompt to send to Claude, applying templates from settings and project config.
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/PromptBuilder.swift (58 lines)
 *
 * Priority chain:
 *  1. Issue card: apply githubIssuePromptTemplate (project -> settings -> default)
 *  2. Manual task: use promptBody
 *  3. Session card: use name as-is
 *
 * Then wrap with promptTemplate (project -> settings -> ""):
 *  - If template contains ${prompt}, interpolate
 *  - Otherwise prepend template + newline
 */

const DEFAULT_ISSUE_TEMPLATE = '#${number}: ${title}\n\n${body}';

export function buildPrompt(
  link: Link,
  project?: Project | null,
  settings?: Partial<Pick<Settings, 'promptTemplate' | 'githubIssuePromptTemplate'>> | null,
): string {
  let prompt: string;

  if (link.issueLink != null) {
    // GitHub issue: apply issue template
    const issueTemplate =
      project?.githubIssuePromptTemplate ??
      settings?.githubIssuePromptTemplate ??
      DEFAULT_ISSUE_TEMPLATE;

    // Strip the "#N: " prefix from name to get clean title
    const title = link.name?.replace(`#${link.issueLink.number}: `, '') ?? '';

    prompt = applyTemplate(issueTemplate, {
      number: String(link.issueLink.number),
      title,
      body: link.issueLink.body ?? '',
      url: link.issueLink.url ?? '',
    });
  } else if (link.promptBody != null) {
    prompt = link.promptBody;
  } else {
    prompt = link.name ?? '';
  }

  // Wrap with prompt template (prefix/suffix)
  const template = project?.promptTemplate ?? settings?.promptTemplate ?? '';
  if (template.length > 0) {
    if (template.includes('${prompt}')) {
      prompt = applyTemplate(template, { prompt });
    } else {
      // Template has no placeholder -- prepend it
      prompt = template + '\n' + prompt;
    }
  }

  return prompt.trim();
}

/**
 * Replace ${key} placeholders with values from the variables dictionary.
 */
export function applyTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`\${${key}}`, value);
  }
  return result;
}
