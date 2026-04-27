import type { ProseMirrorDoc, ProseMirrorNode } from '../types.js';
import { createGranolaDebug } from './debug.js';
import { htmlToMarkdown } from './html.js';

const debug = createGranolaDebug('lib:prosemirror');

export function toMarkdown(doc: ProseMirrorDoc | string | null): string {
  debug('toMarkdown called with doc: %O', doc);
  if (typeof doc === 'string') {
    debug('string input detected, delegating to htmlToMarkdown');
    return htmlToMarkdown(doc);
  }
  if (!doc?.content) {
    debug('No content in doc, returning empty string');
    return '';
  }
  const result = doc.content.map((n) => nodeToMd(n)).join('\n\n');
  debug('toMarkdown result: %s', result);
  return result;
}

function nodeToMd(node: ProseMirrorNode): string {
  debug('nodeToMd processing node type: %s, node: %O', node.type, node);
  let result: string;
  switch (node.type) {
    case 'heading': {
      const lvl = (node.attrs?.level as number) || 1;
      result = `${'#'.repeat(lvl)} ${inlineToMd(node.content)}`;
      break;
    }
    case 'paragraph':
      result = inlineToMd(node.content);
      break;
    case 'bulletList':
      result = (node.content || []).map((li) => nodeToMd(li)).join('\n');
      break;
    case 'orderedList':
      result = (node.content || [])
        .map((li, i) => nodeToMd(li).replace(/^- /, `${i + 1}. `))
        .join('\n');
      break;
    case 'listItem':
      result = `- ${(node.content || []).map((c) => nodeToMd(c)).join('\n  ')}`;
      break;
    case 'blockquote':
      result = (node.content || []).map((c) => `> ${nodeToMd(c)}`).join('\n');
      break;
    case 'codeBlock': {
      const lang = (node.attrs?.language as string) || '';
      result = `\`\`\`${lang}\n${inlineToMd(node.content)}\n\`\`\``;
      break;
    }
    case 'horizontalRule':
      result = '---';
      break;
    case 'text':
      result = applyMarks(node.text || '', node.marks);
      break;
    default:
      debug('Unknown node type: %s', node.type);
      result = node.content ? node.content.map((c) => nodeToMd(c)).join('') : '';
  }
  debug('nodeToMd result for %s: %s', node.type, result);
  return result;
}

function inlineToMd(content?: ProseMirrorNode[]): string {
  return content ? content.map((n) => nodeToMd(n)).join('') : '';
}

function applyMarks(text: string, marks?: Array<{ type: string }>): string {
  if (!marks) return text;
  for (const m of marks) {
    if (m.type === 'bold' || m.type === 'strong') text = `**${text}**`;
    if (m.type === 'italic' || m.type === 'em') text = `*${text}*`;
    if (m.type === 'code') text = `\`${text}\``;
    if (m.type === 'strike') text = `~~${text}~~`;
  }
  return text;
}
