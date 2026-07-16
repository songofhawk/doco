// YDoc → ProseMirror JSON → Markdown（无浏览器依赖）
// schema 与前端 DocoEditor 注册的扩展保持一致，保证导出所见即所得
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { Node as PMNode } from 'prosemirror-model';
import { MarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown';
import { documentSchema as schema } from './document-schema.js';

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

function spreadsheetCsv(data) {
  const rows = Math.max(1, Number(data?.rows) || 1);
  const cols = Math.max(1, Number(data?.cols) || 1);
  const columnName = (index) => {
    let result = '';
    let value = index + 1;
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  };
  const escape = (value) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => escape(String(data?.cells?.[`${columnName(col)}${row + 1}`] || ''))).join(',')
  ).join('\n');
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

  spreadsheetBlock: (state, node) => {
    state.write('```csv\n');
    state.text(spreadsheetCsv(node.attrs.data), false);
    state.ensureNewLine();
    state.write('```');
    state.closeBlock(node);
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

export function documentToMarkdown(document) {
  const doc = PMNode.fromJSON(schema, document);
  return serializer.serialize(doc, { tightLists: true });
}

export function markdownWarnings(document) {
  const warnings = [];
  const seen = new Set();
  const add = (code, message) => { if (!seen.has(code)) { seen.add(code); warnings.push({ code, message }); } };
  const visit = (node) => {
    if (node.type === 'calloutBlock') add('callout_degraded', 'Callout 导出为引用块，颜色属性不会保留');
    if (node.type === 'image' && (node.attrs?.width || node.attrs?.height || node.attrs?.align)) add('image_layout_lost', 'Markdown 无法完整保留图片尺寸和对齐');
    if (node.type === 'table') add('table_attributes_lost', 'Markdown 表格无法保留合并单元格和列宽');
    if (node.type === 'spreadsheetBlock') add('spreadsheet_degraded', '电子表格导出为 CSV 代码块，公式、格式、筛选和冻结设置不会保留');
    if (node.attrs?.textAlign && node.attrs.textAlign !== 'left') add('text_alignment_lost', 'Markdown 无法保留文本对齐');
    for (const mark of node.marks || []) if (mark.type === 'textStyle' || mark.type === 'highlight') add('text_style_lost', 'Markdown 无法完整保留颜色和高亮样式');
    node.content?.forEach(visit);
  };
  visit(document);
  return warnings;
}
