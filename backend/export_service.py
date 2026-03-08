"""
Markdown 导出服务
自动将文档导出为 Markdown 格式，支持文件夹结构和图片软链接
"""
import os
import logging
from pathlib import Path
from typing import Optional
import y_py as Y
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Document, Folder, YDocUpdate, Attachment, KnowledgeBase
from database import AsyncSessionLocal

logger = logging.getLogger("doco.export")

# 导出根目录 - 使用相对路径，相对于 backend 目录
EXPORT_ROOT = Path(__file__).parent.parent / "exports"
IMAGES_DIR = EXPORT_ROOT / "images"


async def export_document_to_markdown(doc_id: str, session: AsyncSession) -> Optional[Path]:
    """
    导出单个文档为 Markdown
    返回导出的文件路径
    """
    try:
        # 1. 获取文档信息
        doc_result = await session.execute(
            select(Document).where(Document.id == doc_id)
        )
        doc = doc_result.scalar_one_or_none()
        if not doc:
            logger.warning(f"Document {doc_id} not found")
            return None

        # 2. 重建 YDoc - 使用与 WebSocket 服务器相同的方式
        from main import DocoYStore
        ydoc = Y.YDoc()
        store = DocoYStore(doc_id)
        await store.apply_updates(ydoc)

        # 3. 提取内容转为 Markdown
        markdown_content = await _ydoc_to_markdown(ydoc, doc)

        # 4. 确定导出路径
        export_path = await _get_export_path(doc, session)

        # 5. 写入文件
        export_path.parent.mkdir(parents=True, exist_ok=True)
        export_path.write_text(markdown_content, encoding="utf-8")

        # 6. 处理图片软链接
        await _setup_image_symlinks(doc, export_path.parent, session)

        logger.info(f"Exported {doc.title} to {export_path}")
        return export_path

    except Exception as e:
        logger.error(f"Failed to export document {doc_id}: {e}")
        return None


async def _ydoc_to_markdown(ydoc: Y.YDoc, doc: Document) -> str:
    """将 YDoc 转换为 Markdown"""
    try:
        xml_fragment = ydoc.get_xml_element("default")
        content = _xml_to_markdown(xml_fragment, 0)
        return f"# {doc.title}\n\n{content.strip()}"
    except Exception as e:
        logger.error(f"Failed to convert YDoc to markdown: {e}", exc_info=True)
        return f"# {doc.title}\n\n(导出失败)"


def _xml_to_markdown(node, depth=0) -> str:
    """递归转换 YXmlElement 为 Markdown"""
    result = []

    # 使用索引访问子节点
    child = node.first_child if hasattr(node, 'first_child') else None

    while child is not None:
        # YXmlText 节点
        if not hasattr(child, 'name'):
            result.append(str(child))
            child = child.next_sibling
            continue

        # YXmlElement 节点
        tag = child.name
        attrs = dict(child.attributes()) if hasattr(child, 'attributes') else {}

        if tag == 'paragraph':
            content = _xml_to_markdown(child, depth)
            result.append(content + '\n\n')
        elif tag == 'heading':
            level = int(attrs.get('level', 1))
            content = _xml_to_markdown(child, depth)
            result.append('#' * level + ' ' + content + '\n\n')
        elif tag == 'codeBlock':
            lang = attrs.get('language', '')
            content = _xml_to_markdown(child, depth)
            result.append(f'```{lang}\n{content}\n```\n\n')
        elif tag == 'bulletList':
            item = child.first_child
            while item is not None:
                item_content = _xml_to_markdown(item, depth + 1)
                result.append('  ' * depth + '- ' + item_content.strip() + '\n')
                item = item.next_sibling
            result.append('\n')
        elif tag == 'orderedList':
            item = child.first_child
            idx = 1
            while item is not None:
                item_content = _xml_to_markdown(item, depth + 1)
                result.append('  ' * depth + f'{idx}. ' + item_content.strip() + '\n')
                idx += 1
                item = item.next_sibling
            result.append('\n')
        elif tag == 'listItem':
            result.append(_xml_to_markdown(child, depth))
        elif tag == 'blockquote':
            content = _xml_to_markdown(child, depth)
            lines = content.strip().split('\n')
            result.append('\n'.join('> ' + line for line in lines) + '\n\n')
        elif tag == 'hardBreak':
            result.append('\n')
        elif tag == 'horizontalRule':
            result.append('---\n\n')
        elif tag == 'image':
            src = attrs.get('src', '')
            alt = attrs.get('alt', '')
            result.append(f'![{alt}]({src})\n\n')
        elif tag == 'mermaidBlock':
            code = attrs.get('code', '')
            result.append(f'```mermaid\n{code}\n```\n\n')
        elif tag == 'plantUMLBlock':
            code = attrs.get('code', '')
            result.append(f'```plantuml\n{code}\n```\n\n')
        elif tag == 'calloutBlock':
            emoji = attrs.get('emoji', '💡')
            content = _xml_to_markdown(child, depth)
            result.append(f'{emoji} {content}\n\n')
        elif tag == 'table':
            result.append(_table_to_markdown(child) + '\n\n')
        else:
            result.append(_xml_to_markdown(child, depth))

        child = child.next_sibling

    return ''.join(result)


def _table_to_markdown(table_node) -> str:
    """转换表格为 Markdown"""
    rows = []
    row = table_node.first_child

    while row is not None:
        if hasattr(row, 'name'):
            cells = []
            cell = row.first_child
            while cell is not None:
                if hasattr(cell, 'name'):
                    content = _xml_to_markdown(cell, 0).strip()
                    cells.append(content)
                cell = cell.next_sibling
            if cells:
                rows.append('| ' + ' | '.join(cells) + ' |')
        row = row.next_sibling

    if len(rows) > 0:
        header = rows[0]
        separator = '| ' + ' | '.join(['---'] * header.count('|')) + ' |'
        return '\n'.join([header, separator] + rows[1:])
    return ''


async def _get_export_path(doc: Document, session: AsyncSession) -> Path:
    """获取文档的导出路径"""
    # 构建文件夹路径
    folder_path = EXPORT_ROOT

    if doc.kb_id:
        kb_result = await session.execute(
            select(KnowledgeBase).where(KnowledgeBase.id == doc.kb_id)
        )
        kb = kb_result.scalar_one_or_none()
        if kb:
            folder_path = folder_path / _sanitize_filename(kb.name)

    if doc.folder_id:
        folders = await _get_folder_path(doc.folder_id, session)
        for folder_name in folders:
            folder_path = folder_path / _sanitize_filename(folder_name)

    # 文件名
    filename = _sanitize_filename(doc.title) + ".md"
    return folder_path / filename


async def _get_folder_path(folder_id: int, session: AsyncSession) -> list[str]:
    """递归获取文件夹路径"""
    path = []
    current_id = folder_id

    while current_id:
        result = await session.execute(
            select(Folder).where(Folder.id == current_id)
        )
        folder = result.scalar_one_or_none()
        if not folder:
            break
        path.insert(0, folder.name)
        current_id = folder.parent_id

    return path


async def _setup_image_symlinks(doc: Document, doc_dir: Path, session: AsyncSession):
    """为文档目录设置图片软链接"""
    # 获取文档的所有附件
    attachments_result = await session.execute(
        select(Attachment).where(Attachment.doc_id == doc.id)
    )
    attachments = attachments_result.scalars().all()

    if not attachments:
        return

    # 创建文档的 images 目录
    doc_images_dir = doc_dir / "images"
    doc_images_dir.mkdir(exist_ok=True)

    # 确保中心图片目录存在
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    for attachment in attachments:
        if not attachment.mime_type.startswith("image/"):
            continue

        # 源文件路径
        source_path = Path(attachment.filepath)
        if not source_path.exists():
            continue

        # 中心存储路径
        central_image = IMAGES_DIR / attachment.filename

        # 复制到中心存储（如果不存在）
        if not central_image.exists():
            import shutil
            shutil.copy2(source_path, central_image)

        # 创建软链接
        symlink_path = doc_images_dir / attachment.filename
        if symlink_path.exists() or symlink_path.is_symlink():
            symlink_path.unlink()

        # 计算相对路径
        relative_path = os.path.relpath(central_image, doc_images_dir)
        symlink_path.symlink_to(relative_path)


def _sanitize_filename(name: str) -> str:
    """清理文件名，移除非法字符"""
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        name = name.replace(char, "_")
    return name.strip()


def _markdown_to_ydoc(markdown: str) -> Y.YDoc:
    """将 Markdown 转换为 YDoc（简化实现）"""
    import re

    ydoc = Y.YDoc()
    xml_fragment = ydoc.get_xml_element("default")

    lines = markdown.split('\n')
    i = 0

    with ydoc.begin_transaction() as txn:
        while i < len(lines):
            line = lines[i]

            # 标题
            if match := re.match(r'^(#{1,6})\s+(.+)$', line):
                level = len(match.group(1))
                text = match.group(2)
                heading = xml_fragment.push_xml_element(txn, 'heading')
                heading.set_attribute(txn, 'level', str(level))
                h_text = heading.push_xml_text(txn)
                h_text.insert(txn, 0, text)
                i += 1

            # 代码块
            elif line.startswith('```'):
                lang = line[3:].strip()
                code_lines = []
                i += 1
                while i < len(lines) and not lines[i].startswith('```'):
                    code_lines.append(lines[i])
                    i += 1
                code_block = xml_fragment.push_xml_element(txn, 'codeBlock')
                if lang:
                    code_block.set_attribute(txn, 'language', lang)
                cb_text = code_block.push_xml_text(txn)
                cb_text.insert(txn, 0, '\n'.join(code_lines))
                i += 1

            # 无序列表
            elif line.strip().startswith('- '):
                bullet_list = xml_fragment.push_xml_element(txn, 'bulletList')
                while i < len(lines) and lines[i].strip().startswith('- '):
                    item = bullet_list.push_xml_element(txn, 'listItem')
                    para = item.push_xml_element(txn, 'paragraph')
                    p_text = para.push_xml_text(txn)
                    p_text.insert(txn, 0, lines[i].strip()[2:])
                    i += 1

            # 有序列表
            elif re.match(r'^\d+\.\s+', line.strip()):
                ordered_list = xml_fragment.push_xml_element(txn, 'orderedList')
                while i < len(lines) and re.match(r'^\d+\.\s+', lines[i].strip()):
                    item = ordered_list.push_xml_element(txn, 'listItem')
                    para = item.push_xml_element(txn, 'paragraph')
                    text = re.sub(r'^\d+\.\s+', '', lines[i].strip())
                    p_text = para.push_xml_text(txn)
                    p_text.insert(txn, 0, text)
                    i += 1

            # 引用
            elif line.strip().startswith('> '):
                blockquote = xml_fragment.push_xml_element(txn, 'blockquote')
                para = blockquote.push_xml_element(txn, 'paragraph')
                p_text = para.push_xml_text(txn)
                p_text.insert(txn, 0, line.strip()[2:])
                i += 1

            # 分隔线
            elif line.strip() in ['---', '***', '___']:
                xml_fragment.push_xml_element(txn, 'horizontalRule')
                i += 1

            # 空行
            elif not line.strip():
                i += 1

            # 普通段落
            else:
                para = xml_fragment.push_xml_element(txn, 'paragraph')
                p_text = para.push_xml_text(txn)
                p_text.insert(txn, 0, line)
                i += 1

    return ydoc


async def save_markdown_content(doc_id: str, markdown: str, session: AsyncSession) -> Optional[Path]:
    """
    保存前端转换好的 Markdown 内容
    """
    try:
        # 获取文档信息
        doc_result = await session.execute(
            select(Document).where(Document.id == doc_id)
        )
        doc = doc_result.scalar_one_or_none()
        if not doc:
            logger.warning(f"Document {doc_id} not found")
            return None

        # 确定导出路径
        export_path = await _get_export_path(doc, session)

        # 写入文件
        export_path.parent.mkdir(parents=True, exist_ok=True)
        export_path.write_text(markdown, encoding="utf-8")

        # 处理图片软链接
        await _setup_image_symlinks(doc, export_path.parent, session)

        logger.info(f"Saved markdown for {doc.title} to {export_path}")
        return export_path

    except Exception as e:
        logger.error(f"Failed to save markdown for {doc_id}: {e}")
        return None
