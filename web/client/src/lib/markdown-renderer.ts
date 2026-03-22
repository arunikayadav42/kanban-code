/**
 * Markdown renderer utility -- renders GitHub-flavored markdown to safe HTML.
 *
 * Uses `marked` for GFM parsing + `dompurify` for XSS sanitization.
 * Used by CardDetailView's Issue and PR tabs.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked for GFM
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Renders a markdown string to sanitized HTML.
 *
 * @param md - The raw markdown string.
 * @returns Safe HTML string with XSS vectors removed.
 */
export function renderMarkdown(md: string): string {
  if (!md) return '';

  // marked.parse can return string | Promise<string> depending on config.
  // With synchronous config (no async extensions), it returns string.
  const raw = marked.parse(md) as string;

  return DOMPurify.sanitize(raw, {
    // Allow common safe tags for rendered markdown
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'a', 'strong', 'em', 'del', 's',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'img',
      'input', // GFM task lists
      'div', 'span',
      'details', 'summary',
      'sup', 'sub',
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'alt', 'src',
      'class', 'id',
      'type', 'checked', 'disabled', // task list checkboxes
      'align',
      'target', 'rel',
    ],
    // Open links in new tab
    ADD_ATTR: ['target'],
  });
}
