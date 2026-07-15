import { Extension, Node as TiptapNode, getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { generateHTML, generateJSON } from '@tiptap/html/server';
import { MarkdownParser, defaultMarkdownParser } from 'prosemirror-markdown';
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import { ulid } from 'ulid';
import { ApiError } from './open-api/errors.js';

export const BLOCK_TYPES = [
  'paragraph', 'heading', 'blockquote', 'horizontalRule', 'codeBlock',
  'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem',
  'image', 'table', 'tableRow', 'tableHeader', 'tableCell',
  'mermaidBlock', 'plantUMLBlock', 'calloutBlock',
];

export function createBlockId() {
  return `block_${ulid()}`;
}

const BlockIds = Extension.create({
  name: 'docoBlockIds',
  addGlobalAttributes() {
    return [{
      types: BLOCK_TYPES,
      attributes: {
        id: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-block-id'),
          renderHTML: (attrs) => attrs.id ? { 'data-block-id': attrs.id } : {},
        },
      },
    }];
  },
});

const DocoDocument = TiptapNode.create({ name: 'doc', topNode: true, content: 'block*' });

const MermaidBlock = TiptapNode.create({
  name: 'mermaidBlock', group: 'block', atom: true,
  addAttributes() { return { code: { default: '', parseHTML: (el) => el.getAttribute('data-code'), renderHTML: (attrs) => ({ 'data-code': attrs.code || '' }) } }; },
  parseHTML() { return [{ tag: 'div[data-type="mermaid"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', { ...HTMLAttributes, 'data-type': 'mermaid' }]; },
});

const PlantUMLBlock = TiptapNode.create({
  name: 'plantUMLBlock', group: 'block', atom: true,
  addAttributes() { return { code: { default: '', parseHTML: (el) => el.getAttribute('data-code'), renderHTML: (attrs) => ({ 'data-code': attrs.code || '' }) } }; },
  parseHTML() { return [{ tag: 'div[data-type="plantuml"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', { ...HTMLAttributes, 'data-type': 'plantuml' }]; },
});

const CalloutBlock = TiptapNode.create({
  name: 'calloutBlock', group: 'block', content: 'block+',
  addAttributes() { return {
    emoji: { default: '💡', parseHTML: (el) => el.getAttribute('data-emoji'), renderHTML: (attrs) => ({ 'data-emoji': attrs.emoji }) },
    color: { default: 'blue', parseHTML: (el) => el.getAttribute('data-color'), renderHTML: (attrs) => ({ 'data-color': attrs.color }) },
  }; },
  parseHTML() { return [{ tag: 'div[data-type="callout"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', { ...HTMLAttributes, 'data-type': 'callout' }, 0]; },
});

const DocoImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      attachmentId: { default: null, parseHTML: (el) => el.getAttribute('data-attachment-id'), renderHTML: (attrs) => attrs.attachmentId ? { 'data-attachment-id': attrs.attachmentId } : {} },
      width: { default: null },
      height: { default: null },
      align: { default: 'left', parseHTML: (el) => el.getAttribute('data-align') || 'left' },
    };
  },
});

export const documentExtensions = [
  StarterKit.configure({ document: false }),
  DocoDocument,
  BlockIds,
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  DocoImage,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table,
  TableRow,
  TableHeader,
  TableCell,
  MermaidBlock,
  PlantUMLBlock,
  CalloutBlock,
];

export const documentSchema = getSchema(documentExtensions);

function walkJson(node, visitor) {
  visitor(node);
  if (Array.isArray(node?.content)) node.content.forEach((child) => walkJson(child, visitor));
}

export function normalizeAndValidateDocument(input, { rejectDuplicateIds = true } = {}) {
  if (!input || input.type !== 'doc' || (input.content !== undefined && !Array.isArray(input.content))) {
    throw new ApiError(422, 'invalid_document', '正文根节点必须是 type=doc 且 content 为数组');
  }
  const value = structuredClone(input);
  if (!value.content) value.content = [];
  const ids = new Set();
  let changed = false;
  walkJson(value, (node) => {
    if (!BLOCK_TYPES.includes(node.type)) return;
    node.attrs ||= {};
    if (!node.attrs.id) {
      node.attrs.id = createBlockId();
      changed = true;
    } else if (!/^block_[0-9A-HJKMNP-TV-Z]{26}$/.test(node.attrs.id)) {
      throw new ApiError(422, 'invalid_block_id', `块 ID 非法: ${node.attrs.id}`);
    }
    if (ids.has(node.attrs.id) && rejectDuplicateIds) {
      throw new ApiError(422, 'duplicate_block_id', `块 ID 重复: ${node.attrs.id}`);
    }
    ids.add(node.attrs.id);
  });
  try {
    const parsed = documentSchema.nodeFromJSON(value);
    parsed.check();
    return { document: parsed.toJSON(), changed };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, 'invalid_document_schema', '正文结构不符合 Doco Schema', { reason: error.message });
  }
}

const markdownParser = new MarkdownParser(documentSchema, MarkdownIt('commonmark', { html: false }), {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'listItem' },
  bullet_list: { block: 'bulletList' },
  ordered_list: { block: 'orderedList', getAttrs: (token) => ({ start: Number(token.attrGet('start')) || 1 }) },
  heading: { block: 'heading', getAttrs: (token) => ({ level: Number(token.tag.slice(1)) }) },
  code_block: { block: 'codeBlock', noCloseToken: true },
  fence: { block: 'codeBlock', getAttrs: (token) => ({ language: token.info.trim() || null }), noCloseToken: true },
  hr: { node: 'horizontalRule' },
  image: { node: 'image', getAttrs: (token) => ({
    src: token.attrGet('src'), title: token.attrGet('title') || null,
    alt: token.children?.[0]?.content || null,
  }) },
  hardbreak: { node: 'hardBreak' },
  em: { mark: 'italic' }, strong: { mark: 'bold' },
  link: { mark: 'link', getAttrs: (token) => ({ href: token.attrGet('href'), title: token.attrGet('title') || null }) },
  code_inline: { mark: 'code', noCloseToken: true },
});

export function markdownToDocument(markdown) {
  let json;
  try { json = markdownParser.parse(markdown).toJSON(); }
  catch (error) { throw new ApiError(422, 'invalid_markdown', 'Markdown 解析失败', { reason: error.message }); }
  walkJson(json, (node) => {
    if (node.type !== 'codeBlock') return;
    const language = String(node.attrs?.language || '').toLowerCase();
    if (language === 'mermaid') {
      node.type = 'mermaidBlock'; node.attrs = { code: node.content?.[0]?.text || '' }; delete node.content;
    } else if (language === 'plantuml') {
      node.type = 'plantUMLBlock'; node.attrs = { code: node.content?.[0]?.text || '' }; delete node.content;
    }
  });
  return normalizeAndValidateDocument(json).document;
}

export function htmlToDocument(html) {
  const clean = sanitizeHtml(html, {
    allowedTags: [
      'p', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'hr', 'br', 'pre', 'code',
      'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 's', 'del', 'u', 'a', 'span', 'mark',
      'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div',
    ],
    allowedAttributes: {
      '*': ['data-block-id', 'data-type', 'data-code', 'data-emoji', 'data-color', 'style'],
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'data-align', 'data-attachment-id'],
      td: ['colspan', 'rowspan', 'colwidth'], th: ['colspan', 'rowspan', 'colwidth'],
      ol: ['start'], code: ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    allowedStyles: { '*': { color: [/^#[0-9a-f]{3,8}$/i, /^rgb/], 'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb/], 'text-align': [/^(left|center|right|justify)$/] } },
  });
  try { return normalizeAndValidateDocument(generateJSON(clean, documentExtensions)).document; }
  catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, 'invalid_html', 'HTML 解析失败', { reason: error.message });
  }
}

export function documentToHtml(document) {
  return generateHTML(document, documentExtensions);
}

export function findNodeById(document, id) {
  let found = null;
  const visit = (node, parent = null, index = 0) => {
    if (found) return;
    if (node.attrs?.id === id) { found = { node, parent, index }; return; }
    node.content?.forEach((child, childIndex) => visit(child, node, childIndex));
  };
  visit(document);
  return found;
}

export function collectAttachmentIds(document) {
  const ids = new Set();
  walkJson(document, (node) => { if (node.type === 'image' && node.attrs?.attachmentId) ids.add(node.attrs.attachmentId); });
  return ids;
}

export { defaultMarkdownParser };
