import TurndownService from 'turndown';
import { createGranolaDebug } from './debug.js';

const debug = createGranolaDebug('lib:html');

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  // Match the horizontal-rule output of src/lib/prosemirror.ts (turndown's default is '* * *').
  hr: '---',
});

/**
 * Converts an HTML string to Markdown.
 *
 * Used for enhanced notes that the Granola backend stores as raw HTML
 * (typically meetings authored via the mobile quick-notes feature).
 *
 * @param html - HTML string from the API
 * @returns Markdown representation, or empty string for empty input
 */
export function htmlToMarkdown(html: string): string {
  debug('htmlToMarkdown called with %d chars', html.length);
  if (!html) {
    return '';
  }
  // Turndown emits 3 spaces after `-` (ul) and 2 spaces after `1.` (ol). Collapse both
  // to a single space so output matches src/lib/prosemirror.ts.
  const result = turndown.turndown(html).replace(/^(\s*)(-|\d+\.) {2,3}/gm, '$1$2 ');
  debug('htmlToMarkdown produced %d chars', result.length);
  return result;
}
