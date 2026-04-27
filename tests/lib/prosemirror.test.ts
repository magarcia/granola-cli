import { describe, expect, it } from 'vitest';
import { toMarkdown } from '../../src/lib/prosemirror.js';
import {
  blockquoteDoc,
  bulletListDoc,
  codeBlockDoc,
  complexDoc,
  emptyDoc,
  formattedTextDoc,
  headingDoc,
  horizontalRuleDoc,
  orderedListDoc,
  simpleDoc,
} from '../fixtures/prosemirror.js';

describe('prosemirror', () => {
  describe('toMarkdown', () => {
    it('should return empty string for null doc', () => {
      expect(toMarkdown(null)).toBe('');
    });

    it('should convert HTML string input to markdown', () => {
      const html = '<h3>Title</h3><ul><li>Item</li></ul>';
      const result = toMarkdown(html);
      expect(result).toContain('### Title');
      expect(result).toContain('- Item');
    });

    it('should return empty string for empty HTML string', () => {
      expect(toMarkdown('')).toBe('');
    });

    it('should return empty string for empty doc', () => {
      expect(toMarkdown(emptyDoc)).toBe('');
    });

    it('should convert simple paragraph', () => {
      const result = toMarkdown(simpleDoc);
      expect(result).toBe('Hello, world!');
    });

    it('should convert headings with correct levels', () => {
      const result = toMarkdown(headingDoc);
      expect(result).toContain('# Main Title');
      expect(result).toContain('## Subtitle');
      expect(result).toContain('### Section');
    });

    it('should convert bullet lists', () => {
      const result = toMarkdown(bulletListDoc);
      expect(result).toContain('- First item');
      expect(result).toContain('- Second item');
      expect(result).toContain('- Third item');
    });

    it('should convert ordered lists', () => {
      const result = toMarkdown(orderedListDoc);
      expect(result).toContain('1. Step one');
      expect(result).toContain('2. Step two');
    });

    it('should convert blockquotes', () => {
      const result = toMarkdown(blockquoteDoc);
      expect(result).toContain('> This is a quote.');
    });

    it('should convert code blocks with language', () => {
      const result = toMarkdown(codeBlockDoc);
      expect(result).toContain('```typescript');
      expect(result).toContain('const x = 42;');
      expect(result).toContain('```');
    });

    it('should convert horizontal rules', () => {
      const result = toMarkdown(horizontalRuleDoc);
      expect(result).toContain('Before');
      expect(result).toContain('---');
      expect(result).toContain('After');
    });

    it('should apply text formatting marks', () => {
      const result = toMarkdown(formattedTextDoc);
      expect(result).toContain('**bold**');
      expect(result).toContain('*italic*');
      expect(result).toContain('`code`');
      expect(result).toContain('~~strikethrough~~');
    });

    it('should handle complex documents with multiple node types', () => {
      const result = toMarkdown(complexDoc);
      expect(result).toContain('# Meeting Notes');
      expect(result).toContain('## Key Decisions');
      expect(result).toContain('- **Launch date: **January 15th');
      expect(result).toContain('- Budget approved');
      expect(result).toContain('## Action Items');
      expect(result).toContain('1. Update roadmap');
      expect(result).toContain('2. Schedule review');
      expect(result).toContain('> Important note from stakeholder');
    });

    it('should handle heading without level attribute', () => {
      const doc = {
        type: 'doc' as const,
        content: [
          {
            type: 'heading',
            content: [{ type: 'text', text: 'Default Heading' }],
          },
        ],
      };
      const result = toMarkdown(doc);
      expect(result).toBe('# Default Heading');
    });

    it('should handle code block without language', () => {
      const doc = {
        type: 'doc' as const,
        content: [
          {
            type: 'codeBlock',
            content: [{ type: 'text', text: 'plain code' }],
          },
        ],
      };
      const result = toMarkdown(doc);
      expect(result).toContain('```');
      expect(result).toContain('plain code');
    });

    it('should handle strong mark (alias for bold)', () => {
      const doc = {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'strong text', marks: [{ type: 'strong' }] }],
          },
        ],
      };
      const result = toMarkdown(doc);
      expect(result).toContain('**strong text**');
    });

    it('should handle em mark (alias for italic)', () => {
      const doc = {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'em text', marks: [{ type: 'em' }] }],
          },
        ],
      };
      const result = toMarkdown(doc);
      expect(result).toContain('*em text*');
    });

    it('should handle unknown node types gracefully', () => {
      const doc = {
        type: 'doc' as const,
        content: [
          {
            type: 'unknownNode',
            content: [{ type: 'text', text: 'nested content' }],
          },
        ],
      };
      const result = toMarkdown(doc);
      expect(result).toContain('nested content');
    });

    it('should handle nodes without content', () => {
      const doc = {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph',
          },
        ],
      };
      const result = toMarkdown(doc);
      expect(result).toBe('');
    });

    it('should handle text nodes with no marks', () => {
      const doc = {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'plain text' }],
          },
        ],
      };
      const result = toMarkdown(doc);
      expect(result).toBe('plain text');
    });

    it('should handle bulletList without content', () => {
      const doc = {
        type: 'doc' as const,
        content: [
          {
            type: 'bulletList',
          },
        ],
      };
      const result = toMarkdown(doc);
      expect(result).toBe('');
    });

    it('should handle orderedList without content', () => {
      const doc = {
        type: 'doc' as const,
        content: [
          {
            type: 'orderedList',
          },
        ],
      };
      const result = toMarkdown(doc);
      expect(result).toBe('');
    });

    it('should handle listItem without content', () => {
      const doc = {
        type: 'doc' as const,
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
              },
            ],
          },
        ],
      };
      const result = toMarkdown(doc);
      expect(result).toContain('-');
    });

    it('should handle blockquote without content', () => {
      const doc = {
        type: 'doc' as const,
        content: [
          {
            type: 'blockquote',
          },
        ],
      };
      const result = toMarkdown(doc);
      expect(result).toBe('');
    });

    it('should handle text node without text property', () => {
      const doc = {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text' }],
          },
        ],
      };
      const result = toMarkdown(doc);
      expect(result).toBe('');
    });

    it('should handle unknown node type without content', () => {
      const doc = {
        type: 'doc' as const,
        content: [
          {
            type: 'customNode',
          },
        ],
      };
      const result = toMarkdown(doc);
      expect(result).toBe('');
    });
  });
});
