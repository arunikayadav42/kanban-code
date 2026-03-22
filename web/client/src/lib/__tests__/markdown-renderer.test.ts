import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../markdown-renderer';

describe('renderMarkdown', () => {
  describe('basic rendering', () => {
    it('returns empty string for empty input', () => {
      expect(renderMarkdown('')).toBe('');
    });

    it('returns empty string for null-ish input', () => {
      // @ts-expect-error -- testing runtime guard
      expect(renderMarkdown(null)).toBe('');
      // @ts-expect-error -- testing runtime guard
      expect(renderMarkdown(undefined)).toBe('');
    });

    it('renders plain text as paragraph', () => {
      const html = renderMarkdown('Hello world');
      expect(html).toContain('<p>');
      expect(html).toContain('Hello world');
    });

    it('renders headings', () => {
      const html = renderMarkdown('# Title\n## Subtitle');
      expect(html).toContain('<h1>Title</h1>');
      expect(html).toContain('<h2>Subtitle</h2>');
    });

    it('renders bold and italic', () => {
      const html = renderMarkdown('**bold** and *italic*');
      expect(html).toContain('<strong>bold</strong>');
      expect(html).toContain('<em>italic</em>');
    });

    it('renders inline code', () => {
      const html = renderMarkdown('Use `console.log`');
      expect(html).toContain('<code>console.log</code>');
    });

    it('renders code blocks', () => {
      const html = renderMarkdown('```js\nconst x = 1;\n```');
      expect(html).toContain('<pre>');
      expect(html).toContain('<code');
      expect(html).toContain('const x = 1;');
    });
  });

  describe('GFM features', () => {
    it('renders links', () => {
      const html = renderMarkdown('[GitHub](https://github.com)');
      expect(html).toContain('<a');
      expect(html).toContain('href="https://github.com"');
      expect(html).toContain('GitHub');
    });

    it('renders unordered lists', () => {
      const html = renderMarkdown('- item 1\n- item 2');
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>item 1</li>');
      expect(html).toContain('<li>item 2</li>');
    });

    it('renders ordered lists', () => {
      const html = renderMarkdown('1. first\n2. second');
      expect(html).toContain('<ol>');
      expect(html).toContain('<li>first</li>');
    });

    it('renders tables', () => {
      const md = '| A | B |\n|---|---|\n| 1 | 2 |';
      const html = renderMarkdown(md);
      expect(html).toContain('<table>');
      expect(html).toContain('<th>A</th>');
      expect(html).toContain('<td>1</td>');
    });

    it('renders strikethrough', () => {
      const html = renderMarkdown('~~removed~~');
      expect(html).toContain('<del>removed</del>');
    });

    it('renders task lists', () => {
      const md = '- [x] done\n- [ ] todo';
      const html = renderMarkdown(md);
      expect(html).toContain('input');
    });

    it('renders blockquotes', () => {
      const html = renderMarkdown('> Quote text');
      expect(html).toContain('<blockquote>');
      expect(html).toContain('Quote text');
    });

    it('renders line breaks with GFM breaks', () => {
      const html = renderMarkdown('line 1\nline 2');
      expect(html).toContain('<br');
    });
  });

  describe('XSS sanitization', () => {
    it('strips script tags', () => {
      const html = renderMarkdown('<script>alert("xss")</script>');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('alert');
    });

    it('strips onerror attributes', () => {
      const html = renderMarkdown('<img src=x onerror="alert(1)">');
      expect(html).not.toContain('onerror');
    });

    it('strips javascript: URLs', () => {
      const html = renderMarkdown('[click](javascript:alert(1))');
      expect(html).not.toContain('javascript:');
    });

    it('strips onclick handlers', () => {
      const html = renderMarkdown('<div onclick="alert(1)">click</div>');
      expect(html).not.toContain('onclick');
    });

    it('strips iframe tags', () => {
      const html = renderMarkdown('<iframe src="evil.com"></iframe>');
      expect(html).not.toContain('<iframe');
    });

    it('preserves safe img tags', () => {
      const html = renderMarkdown('![alt](https://example.com/img.png)');
      expect(html).toContain('<img');
      expect(html).toContain('src="https://example.com/img.png"');
      expect(html).toContain('alt="alt"');
    });

    it('preserves safe links', () => {
      const html = renderMarkdown('[safe](https://example.com)');
      expect(html).toContain('<a');
      expect(html).toContain('href="https://example.com"');
    });
  });

  describe('complex markdown', () => {
    it('renders a full issue body with mixed content', () => {
      const md = `# Bug Report

## Description

The app **crashes** when clicking the \`Save\` button.

## Steps to Reproduce

1. Open the app
2. Click *Save*
3. See error

\`\`\`
Error: undefined is not a function
\`\`\`

> This is a critical bug.

| Browser | Status |
|---------|--------|
| Chrome  | Broken |
| Firefox | OK     |

- [x] Confirmed
- [ ] Fix deployed
`;
      const html = renderMarkdown(md);
      expect(html).toContain('<h1>Bug Report</h1>');
      expect(html).toContain('<strong>crashes</strong>');
      expect(html).toContain('<code>Save</code>');
      expect(html).toContain('<ol>');
      expect(html).toContain('<table>');
      expect(html).toContain('<blockquote>');
    });
  });
});
