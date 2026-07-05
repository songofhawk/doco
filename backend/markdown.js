// YDoc → ProseMirror JSON → Markdown（无浏览器依赖）
// schema 与前端 DocoEditor 注册的扩展保持一致，保证导出所见即所得
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { getSchema, Node as TiptapNode } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { TextStyle } from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { Node as PMNode } from 'prosemirror-model';
import { MarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown';

// 自定义节点只需 schema 定义（attrs/content），不需要 NodeView
const MermaidBlock = TiptapNode.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { code: { default: '' } };
  },
});

const PlantUMLBlock = TiptapNode.create({
  name: 'plantUMLBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { code: { default: '' } };
  },
});

const CalloutBlock = TiptapNode.create({
  name: 'calloutBlock',
  group: 'block',
  content: 'block+',
  addAttributes() {
    return { emoji: { default: '💡' }, color: { default: 'blue' } };
  },
});

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null },
      align: { default: 'left' },
    };
  },
});

const schema = getSchema([
  StarterKit,
  TextStyle,
  Highlight,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ResizableImage,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table,
  TableRow,
  TableHeader,
  TableCell,
  MermaidBlock,
  PlantUMLBlock,
  CalloutBlock,
]);

function fencedBlock(state, node, language) {
  const backticks = node.textContent ? node.textContent.match(/`{3,}/gm) : null;
  const fence = backticks ? '`'.repeat(Math.max(...backticks.map(s => s.length)) + 1) : '```';
  state.write(fence + (language || '') + '\n');
  state.text(node.textContent, false);
  state.ensureNewLine();
  state.write(fence);
  state.closeBlock(node);
}

function fencedAttrCode(state, node, language) {
  state.write('```' + language + '\n');
  state.text(node.attrs.code || '', false);
  state.ensureNewLine();
  state.write('```');
  state.closeBlock(node);
}

function cellText(cell) {
  return cell.textContent.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const d = defaultMarkdownSerializer.nodes;

const nodes = {
  text: d.text,
  paragraph: d.paragraph,
  heading: d.heading,
  blockquote: d.blockquote,
  horizontalRule: d.horizontal_rule,

  codeBlock: (state, node) => fencedBlock(state, node, node.attrs.language),

  bulletList: (state, node) => state.renderList(node, '  ', () => '- '),

  orderedList: (state, node) => {
    const start = node.attrs.start || 1;
    const maxW = String(start + node.childCount - 1).length;
    const space = state.repeat(' ', maxW + 2);
    state.renderList(node, space, i => {
      const nStr = String(start + i);
      return state.repeat(' ', maxW - nStr.length) + nStr + '. ';
    });
  },

  listItem: (state, node) => state.renderContent(node),

  hardBreak: (state, node, parent, index) => {
    for (let i = index + 1; i < parent.childCount; i++) {
      if (parent.child(i).type !== node.type) {
        state.write('\\\n');
        return;
      }
    }
  },

  image: (state, node) => {
    const alt = state.esc(node.attrs.alt || '');
    const title = node.attrs.title ? ` "${node.attrs.title.replace(/"/g, '\\"')}"` : '';
    state.write(`![${alt}](${node.attrs.src || ''}${title})`);
  },

  taskList: (state, node) => state.renderList(node, '  ', () => '- '),

  taskItem: (state, node) => {
    state.write(node.attrs.checked ? '[x] ' : '[ ] ');
    state.renderContent(node);
  },

  table: (state, node) => {
    const rows = [];
    node.forEach(row => {
      const cells = [];
      row.forEach(cell => cells.push(cellText(cell)));
      rows.push(cells);
    });
    if (!rows.length) return;
    const width = Math.max(...rows.map(r => r.length));
    const line = cells => '| ' + Array.from({ length: width }, (_, i) => cells[i] || '').join(' | ') + ' |';
    state.write(line(rows[0]));
    state.ensureNewLine();
    state.write('| ' + Array(width).fill('---').join(' | ') + ' |');
    state.ensureNewLine();
    rows.slice(1).forEach(r => {
      state.write(line(r));
      state.ensureNewLine();
    });
    state.closeBlock(node);
  },

  mermaidBlock: (state, node) => fencedAttrCode(state, node, 'mermaid'),
  plantUMLBlock: (state, node) => fencedAttrCode(state, node, 'plantuml'),

  calloutBlock: (state, node) => {
    state.wrapBlock('> ', `> ${node.attrs.emoji} `, node, () => state.renderContent(node));
  },
};

const marks = {
  italic: defaultMarkdownSerializer.marks.em,
  bold: defaultMarkdownSerializer.marks.strong,
  link: defaultMarkdownSerializer.marks.link,
  code: defaultMarkdownSerializer.marks.code,
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  highlight: { open: '==', close: '==', mixable: true, expelEnclosingWhitespace: true },
  underline: { open: '', close: '', mixable: true },
  textStyle: { open: '', close: '', mixable: true },
};

const serializer = new MarkdownSerializer(nodes, marks);

export function ydocToMarkdown(ydoc, field = 'default') {
  const json = yDocToProsemirrorJSON(ydoc, field);
  const doc = PMNode.fromJSON(schema, json);
  return serializer.serialize(doc, { tightLists: true });
}

export function stateToMarkdown(state) {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state instanceof Uint8Array ? state : new Uint8Array(state));
  return ydocToMarkdown(ydoc);
}
