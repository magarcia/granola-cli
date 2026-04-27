import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '../../src/lib/html.js';

describe('html', () => {
  describe('htmlToMarkdown', () => {
    it('should return empty string for empty input', () => {
      expect(htmlToMarkdown('')).toBe('');
    });

    it('should convert paragraphs to plain text', () => {
      expect(htmlToMarkdown('<p>Hello, world!</p>')).toBe('Hello, world!');
    });

    it('should convert h3 to ### heading', () => {
      expect(htmlToMarkdown('<h3>Section</h3>')).toBe('### Section');
    });

    it('should convert all heading levels', () => {
      expect(htmlToMarkdown('<h1>One</h1>')).toContain('# One');
      expect(htmlToMarkdown('<h2>Two</h2>')).toContain('## Two');
      expect(htmlToMarkdown('<h3>Three</h3>')).toContain('### Three');
    });

    it('should convert unordered lists', () => {
      const html = '<ul><li>First</li><li>Second</li></ul>';
      const result = htmlToMarkdown(html);
      expect(result).toContain('- First');
      expect(result).toContain('- Second');
    });

    it('should convert nested unordered lists', () => {
      const html = '<ul><li>Outer<ul><li>Inner</li></ul></li></ul>';
      const result = htmlToMarkdown(html);
      expect(result).toContain('- Outer');
      expect(result).toContain('    - Inner');
    });

    it('should convert ordered lists', () => {
      const html = '<ol><li>Step one</li><li>Step two</li></ol>';
      const result = htmlToMarkdown(html);
      expect(result).toContain('1. Step one');
      expect(result).toContain('2. Step two');
    });

    it('should convert text marks', () => {
      expect(htmlToMarkdown('<p><strong>bold</strong></p>')).toContain('**bold**');
      expect(htmlToMarkdown('<p><em>italic</em></p>')).toContain('*italic*');
      expect(htmlToMarkdown('<p><code>code</code></p>')).toContain('`code`');
    });

    it('should convert links', () => {
      const html = '<p><a href="https://example.com">link</a></p>';
      expect(htmlToMarkdown(html)).toContain('[link](https://example.com)');
    });

    it('should convert blockquotes', () => {
      expect(htmlToMarkdown('<blockquote>Quote</blockquote>')).toContain('> Quote');
    });

    it('should convert horizontal rules', () => {
      expect(htmlToMarkdown('<hr>')).toContain('---');
    });

    it('should convert real-world Granola mobile payload', () => {
      const html =
        '<h3>ALT Carbon Event Insights</h3>\n' +
        '<ul>\n' +
        '<li>Conversation with scientist about IISC-ALT Carbon partnership\n' +
        '<ul>\n' +
        '<li>Learned how their relationship structure works</li>\n' +
        '<li>Understanding of operational dynamics</li>\n' +
        '</ul>\n' +
        '</li>\n' +
        '</ul>\n';
      const result = htmlToMarkdown(html);
      expect(result).toContain('### ALT Carbon Event Insights');
      expect(result).toContain('- Conversation with scientist');
      expect(result).toContain('Learned how their relationship structure works');
      expect(result).toContain('Understanding of operational dynamics');
    });
  });
});
