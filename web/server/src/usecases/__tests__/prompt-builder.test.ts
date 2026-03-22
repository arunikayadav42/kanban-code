import { describe, it, expect } from 'vitest';
import { createLink } from '@kanban-code/shared';
import { buildPrompt, applyTemplate } from '../prompt-builder.js';

/**
 * Port of Tests/KanbanCodeCoreTests/PromptBuilderTests.swift (114 lines, 10 test cases)
 */

describe('PromptBuilder', () => {
  it('manual task uses promptBody as-is', () => {
    const link = createLink({
      id: 'card_test',
      name: 'Fix the bug',
      source: 'manual',
      promptBody: 'Fix the authentication bug in the login flow',
    });
    const prompt = buildPrompt(link);
    expect(prompt).toBe('Fix the authentication bug in the login flow');
  });

  it('GitHub issue applies default template', () => {
    const link = createLink({
      id: 'card_test',
      name: '#42: Fix login',
      source: 'github_issue',
      issueLink: { number: 42, body: 'The login form crashes' },
    });
    const prompt = buildPrompt(link);
    expect(prompt).toContain('#42:');
    expect(prompt).toContain('The login form crashes');
  });

  it('GitHub issue with custom template', () => {
    const link = createLink({
      id: 'card_test',
      name: '#42: Fix login',
      source: 'github_issue',
      issueLink: { number: 42, body: 'Bug report' },
    });
    const prompt = buildPrompt(link, null, {
      githubIssuePromptTemplate: 'Issue ${number}: ${body}',
    });
    expect(prompt).toBe('Issue 42: Bug report');
  });

  it('project template overrides global', () => {
    const link = createLink({
      id: 'card_test',
      name: '#10: Feature',
      source: 'github_issue',
      issueLink: { number: 10, body: 'Add dark mode' },
    });
    const prompt = buildPrompt(
      link,
      {
        path: '/p',
        name: 'p',
        visible: true,
        githubIssuePromptTemplate: 'PROJECT: ${body}',
      },
      { githubIssuePromptTemplate: 'GLOBAL: ${body}' },
    );
    expect(prompt).toBe('PROJECT: Add dark mode');
  });

  it('prompt template wraps the result', () => {
    const link = createLink({
      id: 'card_test',
      name: 'Fix bug',
      source: 'manual',
      promptBody: 'Fix the bug',
    });
    const prompt = buildPrompt(link, null, {
      promptTemplate: 'You are a senior engineer. ${prompt}',
    });
    expect(prompt).toBe('You are a senior engineer. Fix the bug');
  });

  it('session card uses name as-is', () => {
    const link = createLink({
      id: 'card_test',
      name: 'Implement feature X',
      sessionLink: { sessionId: 's1' },
    });
    const prompt = buildPrompt(link);
    expect(prompt).toBe('Implement feature X');
  });

  it('card with no name or body returns empty', () => {
    const link = createLink({
      id: 'card_test',
      source: 'discovered',
    });
    const prompt = buildPrompt(link);
    expect(prompt).toBe('');
  });

  it('prompt template without placeholder prepends to prompt', () => {
    const link = createLink({
      id: 'card_test',
      name: 'Fix bug',
      source: 'manual',
      promptBody: 'Fix the auth bug',
    });
    const prompt = buildPrompt(link, null, {
      promptTemplate: 'You are a senior engineer.',
    });
    expect(prompt).toBe('You are a senior engineer.\nFix the auth bug');
  });

  describe('applyTemplate', () => {
    it('replaces variables', () => {
      const result = applyTemplate(
        'Hello ${name}, you have ${count} items',
        { name: 'Alice', count: '3' },
      );
      expect(result).toBe('Hello Alice, you have 3 items');
    });

    it('handles missing variables (leaves placeholder)', () => {
      const result = applyTemplate(
        'Hello ${name}, ${missing} here',
        { name: 'Bob' },
      );
      expect(result).toBe('Hello Bob, ${missing} here');
    });
  });
});
