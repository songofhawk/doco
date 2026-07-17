import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    Folder, FileText, ChevronRight, ChevronDown, Plus, Library,
    Search, Pencil, Trash2, X, MoreHorizontal, Link, FolderInput, Copy, Sheet
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiFetch } from '../auth';

/* ---- 右键菜单 ---- */
type MenuItem = { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean } | 'divider';

const ContextMenu = ({ x, y, items, onClose }: {
    x: number; y: number;
    items: MenuItem[];
    onClose: () => void;
}) => {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    return createPortal(
        <div ref={ref} className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[160px] text-sm"
            style={{ top: y, left: x }}>
            {items.map((item, i) =>
                item === 'divider' ? (
                    <div key={i} className="my-1 border-t border-gray-100" />
                ) : (
                    <button key={i}
                        className={`flex items-center gap-2 w-full px-3 py-1.5 transition-colors ${item.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-100'}`}
                        onClick={() => { item.onClick(); onClose(); }}>
                        {item.icon}{item.label}
                    </button>
                )
            )}
        </div>,
        document.body,
    );
};

/* ---- 内联编辑 ---- */
const InlineEdit = ({ value, onSave, onCancel }: {
    value: string; onSave: (v: string) => void; onCancel: () => void;
}) => {
    const [text, setText] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

    return (
        <input ref={inputRef} value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
                if (e.key === 'Enter' && text.trim()) { e.preventDefault(); onSave(text.trim()); }
                if (e.key === 'Escape') onCancel();
            }}
            onBlur={() => { if (text.trim()) onSave(text.trim()); else onCancel(); }}
            className="flex-1 text-base bg-white border border-blue-400 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-blue-400 min-w-0"
            onClick={e => e.stopPropagation()} />
    );
};

/* ---- 输入对话框 ---- */
const InputDialog = ({ title, placeholder, onConfirm, onClose }: {
    title: string;
    placeholder?: string;
    onConfirm: (value: string) => void;
    onClose: () => void;
}) => {
    const [value, setValue] = useState('');
    const ref = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    const handleSubmit = () => {
        if (value.trim()) { onConfirm(value.trim()); onClose(); }
    };

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div ref={ref} className="bg-white rounded-xl shadow-2xl w-80 overflow-hidden">
                <div className="px-5 pt-5 pb-3">
                    <h3 className="text-sm font-medium text-gray-800 mb-3">{title}</h3>
                    <input
                        ref={inputRef}
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onClose(); }}
                        placeholder={placeholder}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all placeholder:text-gray-300"
                    />
                </div>
                <div className="flex justify-end gap-2 px-5 pb-4 pt-1">
                    <button onClick={onClose}
                        className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                        取消
                    </button>
                    <button onClick={handleSubmit}
                        disabled={!value.trim()}
                        className="px-3 py-1.5 text-xs text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors">
                        确定
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};

/* ---- 移动文档弹窗 ---- */
const MoveDialog = ({ kbs, onMove, onClose }: {
    kbs: any[];
    onMove: (folderId?: number, kbId?: number) => void;
    onClose: () => void;
}) => {
    const ref = useRef<HTMLDivElement>(null);
    const [expanded, setExpanded] = useState<Record<number, boolean>>({});
    const [folders, setFolders] = useState<Record<number, any[]>>({});

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    const loadFolders = async (kbId: number) => {
        if (folders[kbId]) return;
        try {
            const res = await apiFetch(`/kb/${kbId}/folders`);
            if (res.ok) {
                const data = await res.json();
                setFolders(prev => ({ ...prev, [kbId]: data }));
            }
        } catch {}
    };

    const toggleKb = (kbId: number) => {
        setExpanded(prev => ({ ...prev, [kbId]: !prev[kbId] }));
        loadFolders(kbId);
    };

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div ref={ref} className="bg-white rounded-xl shadow-2xl w-72 max-h-80 flex flex-col overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-700">移动到…</span>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 text-sm">
                    {kbs.map(kb => (
                        <div key={kb.id}>
                            <div className="flex items-center px-2 py-1.5 hover:bg-gray-100 rounded-md cursor-pointer"
                                onClick={() => toggleKb(kb.id)}>
                                <span className="mr-1 text-gray-400">
                                    {expanded[kb.id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                </span>
                                <Library size={14} className="mr-2 text-indigo-500" />
                                <span className="flex-1 truncate text-gray-700">{kb.name}</span>
                                <button onClick={e => { e.stopPropagation(); onMove(undefined, kb.id); }}
                                    className="text-xs text-blue-500 hover:text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-50">
                                    选择
                                </button>
                            </div>
                            {expanded[kb.id] && (folders[kb.id] || []).map((f: any) => (
                                <div key={f.id}
                                    className="flex items-center px-2 py-1.5 ml-5 hover:bg-gray-100 rounded-md cursor-pointer"
                                    onClick={() => onMove(f.id)}>
                                    <Folder size={13} className="mr-2 text-amber-500" />
                                    <span className="flex-1 truncate text-gray-600">{f.name}</span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </div>,
        document.body,
    );
};

/* ---- 主侧边栏 ---- */
export const Sidebar = ({ collapsed, onToggle, onDocRenamed }: { collapsed?: boolean; onToggle?: () => void; onDocRenamed?: (docId: string, title: string) => void }) => {
    const location = useLocation();
    const currentDocId = location.pathname.startsWith('/doc/') ? location.pathname.slice(5) : undefined;
    const [kbs, setKbs] = useState<any[]>([]);
    const [expandedKbs, setExpandedKbs] = useState<Record<number, boolean>>({});
    const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({});
    const [content, setContent] = useState<Record<string, any[]>>({});
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[] | null>(null);
    const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: any[] } | null>(null);
    const [editingItem, setEditingItem] = useState<{ type: string; id: number | string } | null>(null);
    const [movingDoc, setMovingDoc] = useState<{ docId: string; fromFolderId?: number; fromKbId?: number } | null>(null);
    const [inputDialog, setInputDialog] = useState<{
        title: string; placeholder?: string;
        onConfirm: (value: string) => void;
    } | null>(null);
    const navigate = useNavigate();
    const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

    const navigateToDoc = (docId: string) => {
        navigate(`/doc/${docId}`);
        if (window.innerWidth < 768) onToggle?.();
    };

    // 加载知识库列表
    useEffect(() => { fetchKbs(); }, []);

    // 根据 URL 中的 docId 自动展开对应的树路径
    useEffect(() => {
        if (!currentDocId) return;

        let cancelled = false;
        const expandToDoc = async () => {
            try {
                const pathRes = await apiFetch(`/docs/${currentDocId}/path`);
                if (!pathRes.ok || cancelled) return;
                const { folder_id, kb_id } = await pathRes.json();
                if (!kb_id || cancelled) return;

                // 加载知识库的顶层文件夹和直属文档
                const fetches: Promise<Response>[] = [
                    apiFetch(`/kb/${kb_id}/folders`),
                    apiFetch(`/kb/${kb_id}/docs`),
                ];
                // 如果文档在文件夹内，也加载该文件夹的内容
                if (folder_id) {
                    fetches.push(
                        apiFetch(`/folders/${folder_id}/docs`),
                        apiFetch(`/folders/${folder_id}/subfolders`),
                    );
                }

                const responses = await Promise.all(fetches);
                if (cancelled) return;

                const updates: Record<string, any[]> = {};
                if (responses[0].ok) updates[`kb_${kb_id}_folders`] = await responses[0].json();
                if (responses[1].ok) updates[`kb_${kb_id}_docs`] = await responses[1].json();
                if (folder_id && responses[2]?.ok) updates[`folder_${folder_id}_docs`] = await responses[2].json();
                if (folder_id && responses[3]?.ok) updates[`folder_${folder_id}_subfolders`] = await responses[3].json();
                if (cancelled) return;

                setExpandedKbs(prev => ({ ...prev, [kb_id]: true }));
                if (folder_id) setExpandedFolders(prev => ({ ...prev, [folder_id]: true }));
                setContent(prev => ({ ...prev, ...updates }));
            } catch (e) {
                console.error('[Sidebar] expand to doc failed:', e);
            }
        };
        expandToDoc();
        return () => { cancelled = true; };
    }, [currentDocId]);

    // 搜索防抖
    useEffect(() => {
        if (!searchQuery.trim()) { setSearchResults(null); return; }
        clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(async () => {
            try {
                const res = await apiFetch(`/search/docs?q=${encodeURIComponent(searchQuery)}`);
                if (res.ok) setSearchResults(await res.json());
            } catch { setSearchResults([]); }
        }, 300);
        return () => clearTimeout(searchTimerRef.current);
    }, [searchQuery]);

    // 监听编辑器标题变更 → 同步侧边栏文档列表
    useEffect(() => {
        const handler = (e: Event) => {
            const { docId, title } = (e as CustomEvent).detail
            setContent(prev => {
                const u = { ...prev }
                for (const k of Object.keys(u)) {
                    if (k.endsWith('_docs'))
                        u[k] = u[k].map((d: any) => d.id === docId ? { ...d, title } : d)
                }
                return u
            })
        }
        window.addEventListener('doc-title-changed', handler)
        return () => window.removeEventListener('doc-title-changed', handler)
    }, [])

    const fetchKbs = async () => {
        try {
            const res = await apiFetch(`/kb`);
            if (res.ok) setKbs(await res.json());
        } catch (e) { console.error('[Sidebar] fetch KBs failed:', e); }
    };

    const toggleKb = async (kbId: number) => {
        setExpandedKbs(prev => ({ ...prev, [kbId]: !prev[kbId] }));
        if (!content[`kb_${kbId}_folders`]) {
            try {
                const [foldersRes, docsRes] = await Promise.all([
                    apiFetch(`/kb/${kbId}/folders`),
                    apiFetch(`/kb/${kbId}/docs`),
                ]);
                const updates: Record<string, any[]> = {};
                if (foldersRes.ok) updates[`kb_${kbId}_folders`] = await foldersRes.json();
                if (docsRes.ok) updates[`kb_${kbId}_docs`] = await docsRes.json();
                setContent(prev => ({ ...prev, ...updates }));
            } catch {}
        }
    };

    const toggleFolder = async (folderId: number) => {
        setExpandedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));
        if (!content[`folder_${folderId}_docs`]) {
            try {
                const [docsRes, subfoldersRes] = await Promise.all([
                    apiFetch(`/folders/${folderId}/docs`),
                    apiFetch(`/folders/${folderId}/subfolders`),
                ]);
                const updates: Record<string, any[]> = {};
                if (docsRes.ok) updates[`folder_${folderId}_docs`] = await docsRes.json();
                if (subfoldersRes.ok) updates[`folder_${folderId}_subfolders`] = await subfoldersRes.json();
                setContent(prev => ({ ...prev, ...updates }));
            } catch {}
        }
    };

    // ---- 创建 ----
    const addKb = () => {
        setInputDialog({
            title: '新建知识库', placeholder: '请输入知识库名称',
            onConfirm: async (name) => {
                try {
                    const res = await apiFetch(`/kb`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name })
                    });
                    if (res.ok) await fetchKbs();
                } catch {}
            }
        });
    };

    const addFolder = (kbId: number, parentId?: number) => {
        setInputDialog({
            title: '新建文件夹', placeholder: '请输入文件夹名称',
            onConfirm: async (name) => {
                try {
                    const body: any = { name, kb_id: kbId };
                    if (parentId) body.parent_id = parentId;
                    const res = await apiFetch(`/folders`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    if (res.ok) {
                        if (parentId) {
                            const r2 = await apiFetch(`/folders/${parentId}/subfolders`);
                            if (r2.ok) {
                                const subfolders = await r2.json();
                                setContent(prev => ({ ...prev, [`folder_${parentId}_subfolders`]: subfolders }));
                            }
                            setExpandedFolders(prev => ({ ...prev, [parentId]: true }));
                        } else {
                            const r2 = await apiFetch(`/kb/${kbId}/folders`);
                            if (r2.ok) {
                                const folders = await r2.json();
                                setContent(prev => ({ ...prev, [`kb_${kbId}_folders`]: folders }));
                            }
                            setExpandedKbs(prev => ({ ...prev, [kbId]: true }));
                        }
                    }
                } catch {}
            }
        });
    };

    const addDoc = (folderId?: number, kbId?: number, documentType: 'document' | 'spreadsheet' = 'document') => {
        const isSpreadsheet = documentType === 'spreadsheet';
        setInputDialog({
            title: isSpreadsheet ? '新建电子表格' : '新建文档',
            placeholder: isSpreadsheet ? '请输入电子表格标题' : '请输入文档标题',
            onConfirm: async (title) => {
                const docId = `doc_${Math.random().toString(36).substr(2, 9)}`;
                try {
                    const body: any = { id: docId, title, document_type: documentType };
                    if (folderId) body.folder_id = folderId;
                    if (kbId) body.kb_id = kbId;
                    const res = await apiFetch(`/docs`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    if (res.ok) {
                        if (folderId) {
                            const r2 = await apiFetch(`/folders/${folderId}/docs`);
                            if (r2.ok) {
                                const docs = await r2.json();
                                setContent(prev => ({ ...prev, [`folder_${folderId}_docs`]: docs }));
                            }
                            setExpandedFolders(prev => ({ ...prev, [folderId]: true }));
                        } else if (kbId) {
                            const r2 = await apiFetch(`/kb/${kbId}/docs`);
                            if (r2.ok) {
                                const docs = await r2.json();
                                setContent(prev => ({ ...prev, [`kb_${kbId}_docs`]: docs }));
                            }
                            setExpandedKbs(prev => ({ ...prev, [kbId]: true }));
                        }
                        navigateToDoc(docId);
                    }
                } catch {}
            }
        });
    };

    // ---- 重命名 ----
    const renameKb = async (kbId: number, newName: string) => {
        try {
            await apiFetch(`/kb/${kbId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName })
            });
            setKbs(prev => prev.map(kb => kb.id === kbId ? { ...kb, name: newName } : kb));
        } catch {}
        setEditingItem(null);
    };

    const renameFolder = async (folderId: number, newName: string) => {
        try {
            await apiFetch(`/folders/${folderId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName })
            });
            setContent(prev => {
                const u = { ...prev };
                for (const k of Object.keys(u)) {
                    if (k.endsWith('_folders') || k.endsWith('_subfolders'))
                        u[k] = u[k].map((f: any) => f.id === folderId ? { ...f, name: newName } : f);
                }
                return u;
            });
        } catch {}
        setEditingItem(null);
    };

    const renameDoc = async (docId: string, newTitle: string) => {
        try {
            await apiFetch(`/docs/${docId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle })
            });
            setContent(prev => {
                const u = { ...prev };
                for (const k of Object.keys(u)) {
                    if (k.endsWith('_docs'))
                        u[k] = u[k].map((d: any) => d.id === docId ? { ...d, title: newTitle } : d);
                }
                return u;
            });
            // 通知编辑器同步标题
            onDocRenamed?.(docId, newTitle)
        } catch {}
        setEditingItem(null);
    };

    // ---- 删除 ----
    const deleteKb = async (kbId: number) => {
        if (!confirm('确定删除此知识库？其下所有文件夹和文档将一并删除。')) return;
        try {
            await apiFetch(`/kb/${kbId}`, { method: 'DELETE' });
            setKbs(prev => prev.filter(kb => kb.id !== kbId));
        } catch {}
    };

    const deleteFolder = async (folderId: number, kbId: number, parentId?: number) => {
        if (!confirm('确定删除此文件夹？其下所有文档将一并删除。')) return;
        try {
            await apiFetch(`/folders/${folderId}`, { method: 'DELETE' });
            if (parentId) {
                setContent(prev => ({
                    ...prev,
                    [`folder_${parentId}_subfolders`]: (prev[`folder_${parentId}_subfolders`] || []).filter((f: any) => f.id !== folderId)
                }));
            } else {
                setContent(prev => ({
                    ...prev,
                    [`kb_${kbId}_folders`]: (prev[`kb_${kbId}_folders`] || []).filter((f: any) => f.id !== folderId)
                }));
            }
        } catch {}
    };

    const deleteDoc = async (docId: string, folderId?: number, kbId?: number) => {
        if (!confirm('确定删除此文档？')) return;
        try {
            await apiFetch(`/docs/${docId}`, { method: 'DELETE' });
            if (folderId) {
                setContent(prev => ({
                    ...prev,
                    [`folder_${folderId}_docs`]: (prev[`folder_${folderId}_docs`] || []).filter((d: any) => d.id !== docId)
                }));
            } else if (kbId) {
                setContent(prev => ({
                    ...prev,
                    [`kb_${kbId}_docs`]: (prev[`kb_${kbId}_docs`] || []).filter((d: any) => d.id !== docId)
                }));
            }
            if (currentDocId === docId) navigate('/');
        } catch {}
    };

    // ---- 移动文档 ----
    const startMoveDoc = (docId: string, fromFolderId?: number, fromKbId?: number) => {
        setMovingDoc({ docId, fromFolderId, fromKbId });
    };

    const moveDocTo = async (targetFolderId?: number, targetKbId?: number) => {
        if (!movingDoc) return;
        try {
            const body: any = { folder_id: targetFolderId || null };
            if (targetKbId && !targetFolderId) body.kb_id = targetKbId;
            await apiFetch(`/docs/${movingDoc.docId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            // 从原位置移除
            if (movingDoc.fromFolderId) {
                setContent(prev => ({
                    ...prev,
                    [`folder_${movingDoc.fromFolderId}_docs`]: (prev[`folder_${movingDoc.fromFolderId}_docs`] || []).filter((d: any) => d.id !== movingDoc.docId)
                }));
            } else if (movingDoc.fromKbId) {
                setContent(prev => ({
                    ...prev,
                    [`kb_${movingDoc.fromKbId}_docs`]: (prev[`kb_${movingDoc.fromKbId}_docs`] || []).filter((d: any) => d.id !== movingDoc.docId)
                }));
            }
            // 刷新目标位置
            if (targetFolderId) {
                const r = await apiFetch(`/folders/${targetFolderId}/docs`);
                if (r.ok) {
                    const docs = await r.json();
                    setContent(prev => ({ ...prev, [`folder_${targetFolderId}_docs`]: docs }));
                }
            } else if (targetKbId) {
                const r = await apiFetch(`/kb/${targetKbId}/docs`);
                if (r.ok) {
                    const docs = await r.json();
                    setContent(prev => ({ ...prev, [`kb_${targetKbId}_docs`]: docs }));
                }
            }
        } catch {}
        setMovingDoc(null);
    };

    // ---- 右键菜单构建 ----
    const showKbMenu = (e: React.MouseEvent, kb: any) => {
        e.preventDefault(); e.stopPropagation();
        setCtxMenu({
            x: e.clientX, y: e.clientY,
            items: [
                { label: '重命名', icon: <Pencil size={14} />, onClick: () => setEditingItem({ type: 'kb', id: kb.id }) },
                { label: '新建文档', icon: <FileText size={14} />, onClick: () => addDoc(undefined, kb.id) },
                { label: '新建电子表格', icon: <Sheet size={14} />, onClick: () => addDoc(undefined, kb.id, 'spreadsheet') },
                { label: '新建文件夹', icon: <Plus size={14} />, onClick: () => addFolder(kb.id) },
                { label: '删除', icon: <Trash2 size={14} />, onClick: () => deleteKb(kb.id), danger: true },
            ]
        });
    };

    const showFolderMenu = (e: React.MouseEvent, folder: any, kbId: number, parentId?: number) => {
        e.preventDefault(); e.stopPropagation();
        setCtxMenu({
            x: e.clientX, y: e.clientY,
            items: [
                { label: '重命名', icon: <Pencil size={14} />, onClick: () => setEditingItem({ type: 'folder', id: folder.id }) },
                { label: '新建文档', icon: <FileText size={14} />, onClick: () => addDoc(folder.id) },
                { label: '新建电子表格', icon: <Sheet size={14} />, onClick: () => addDoc(folder.id, undefined, 'spreadsheet') },
                { label: '新建文件夹', icon: <Plus size={14} />, onClick: () => addFolder(kbId, folder.id) },
                { label: '删除', icon: <Trash2 size={14} />, onClick: () => deleteFolder(folder.id, kbId, parentId), danger: true },
            ]
        });
    };

    const buildDocMenuItems = (doc: any, folderId?: number, kbId?: number): MenuItem[] => [
        { label: '复制链接', icon: <Link size={14} />, onClick: () => navigator.clipboard.writeText(`${window.location.origin}/doc/${doc.id}`) },
        { label: '复制', icon: <Copy size={14} />, onClick: () => addDoc(folderId, kbId, doc.document_type || 'document') },
        'divider',
        { label: '移动到…', icon: <FolderInput size={14} />, onClick: () => startMoveDoc(doc.id, folderId, kbId) },
        { label: '重命名', icon: <Pencil size={14} />, onClick: () => setEditingItem({ type: 'doc', id: doc.id }) },
        'divider',
        { label: '删除', icon: <Trash2 size={14} />, onClick: () => deleteDoc(doc.id, folderId, kbId), danger: true },
    ];

    const showDocMenu = (e: React.MouseEvent, doc: any, folderId?: number, kbId?: number) => {
        e.preventDefault(); e.stopPropagation();
        setCtxMenu({ x: e.clientX, y: e.clientY, items: buildDocMenuItems(doc, folderId, kbId) });
    };

    // ---- 渲染文档项 ----
    const renderDoc = (doc: any, folderId?: number, kbId?: number) => (
        <div key={doc.id}
            className={`doco-sidebar-doc-row flex items-center rounded-md px-2 py-1.5 transition-colors cursor-pointer group ${
                currentDocId === doc.id ? 'is-active' : ''
            }`}
            onClick={() => navigateToDoc(doc.id)}
            onContextMenu={e => showDocMenu(e, doc, folderId, kbId)}>
            {doc.document_type === 'spreadsheet'
                ? <Sheet aria-label="电子表格" size={14} className="mr-2 shrink-0" />
                : <FileText size={14} className="mr-2 shrink-0" />}
            {editingItem?.type === 'doc' && editingItem.id === doc.id ? (
                <InlineEdit value={doc.title}
                    onSave={v => renameDoc(doc.id, v)}
                    onCancel={() => setEditingItem(null)} />
            ) : (
                <span className="flex-1 truncate text-base">{doc.title}</span>
            )}
            <button onClick={e => {
                    e.stopPropagation();
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    setCtxMenu({ x: rect.left, y: rect.bottom + 2, items: buildDocMenuItems(doc, folderId, kbId) });
                }}
                className="p-1 text-gray-400 transition-opacity hover:bg-gray-200 rounded md:opacity-0 md:group-hover:opacity-100">
                <MoreHorizontal size={12} />
            </button>
        </div>
    );

    // ---- 递归渲染文件夹 ----
    const renderFolder = (folder: any, kbId: number, parentId?: number) => (
        <div key={folder.id}>
            <div className="doco-sidebar-folder-row flex items-center rounded-md px-2 py-1.5 transition-colors group cursor-pointer"
                onClick={() => toggleFolder(folder.id)}
                onContextMenu={e => showFolderMenu(e, folder, kbId, parentId)}>
                <span className="mr-1 text-gray-400">
                    {expandedFolders[folder.id] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </span>
                <Folder size={15} className="mr-2 shrink-0 text-amber-500" />
                {editingItem?.type === 'folder' && editingItem.id === folder.id ? (
                    <InlineEdit value={folder.name}
                        onSave={v => renameFolder(folder.id, v)}
                        onCancel={() => setEditingItem(null)} />
                ) : (
                    <span className="flex-1 truncate text-base font-medium">{folder.name}</span>
                )}
                <button onClick={e => {
                        e.stopPropagation();
                        const rect = (e.target as HTMLElement).getBoundingClientRect();
                        setCtxMenu({
                            x: rect.left, y: rect.bottom + 2,
                            items: [
                                { label: '新建文档', icon: <FileText size={14} />, onClick: () => addDoc(folder.id) },
                                { label: '新建电子表格', icon: <Sheet size={14} />, onClick: () => addDoc(folder.id, undefined, 'spreadsheet') },
                                { label: '新建文件夹', icon: <Folder size={14} />, onClick: () => addFolder(kbId, folder.id) },
                            ]
                        });
                    }}
                    className="p-1 text-gray-400 transition-opacity hover:bg-gray-200 rounded md:opacity-0 md:group-hover:opacity-100">
                    <Plus size={12} />
                </button>
                <button onClick={e => {
                        e.stopPropagation();
                        const rect = (e.target as HTMLElement).getBoundingClientRect();
                        setCtxMenu({
                            x: rect.left, y: rect.bottom + 2,
                            items: [
                                { label: '重命名', icon: <Pencil size={14} />, onClick: () => setEditingItem({ type: 'folder', id: folder.id }) },
                                { label: '新建文档', icon: <FileText size={14} />, onClick: () => addDoc(folder.id) },
                                { label: '新建电子表格', icon: <Sheet size={14} />, onClick: () => addDoc(folder.id, undefined, 'spreadsheet') },
                                { label: '新建文件夹', icon: <Plus size={14} />, onClick: () => addFolder(kbId, folder.id) },
                                'divider',
                                { label: '删除', icon: <Trash2 size={14} />, onClick: () => deleteFolder(folder.id, kbId, parentId), danger: true },
                            ]
                        });
                    }}
                    className="p-1 text-gray-400 transition-opacity hover:bg-gray-200 rounded md:opacity-0 md:group-hover:opacity-100">
                    <MoreHorizontal size={12} />
                </button>
            </div>

            {expandedFolders[folder.id] && (
                <div className="doco-sidebar-tree-children doco-sidebar-tree-children-nested">
                    {(content[`folder_${folder.id}_subfolders`] || []).map((sub: any) =>
                        renderFolder(sub, kbId, folder.id)
                    )}
                    {(content[`folder_${folder.id}_docs`] || []).map((doc: any) =>
                        renderDoc(doc, folder.id)
                    )}
                </div>
            )}
        </div>
    );
    return (
        <aside
            id="doco-sidebar"
            aria-hidden={collapsed}
            inert={collapsed}
            className={`doco-sidebar absolute inset-y-0 left-0 z-30 flex h-full w-[min(16rem,calc(100vw-3rem))] shrink-0 flex-col overflow-hidden border-r shadow-xl select-none md:static md:shadow-none ${collapsed ? 'is-collapsed' : ''}`}
        >
            {/* 搜索栏 */}
            <div className="px-3 pt-3 pb-2">
                <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="搜索文档..."
                        className="w-full pl-8 pr-8 py-1.5 text-base bg-gray-100 border-none rounded-md outline-none focus:bg-white focus:ring-1 focus:ring-gray-300 transition-colors placeholder:text-gray-400"
                    />
                    {searchQuery && (
                        <button onClick={() => setSearchQuery('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* 搜索结果 */}
            {searchResults !== null ? (
                <div className="flex-1 overflow-y-auto px-2 pb-2">
                    <div className="px-3 py-1.5 text-sm text-gray-400">
                        {searchResults.length > 0 ? `找到 ${searchResults.length} 个文档` : '无匹配结果'}
                    </div>
                    {searchResults.map(doc => (
                        <button key={doc.id}
                            onClick={() => { navigateToDoc(doc.id); setSearchQuery(''); }}
                            className={`flex items-center px-3 py-2 w-full text-left text-base rounded-md transition-colors ${
                                currentDocId === doc.id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                            }`}>
                            {doc.document_type === 'spreadsheet'
                                ? <Sheet aria-label="电子表格" size={14} className="mr-2 shrink-0 text-[var(--accent)]" />
                                : <FileText size={14} className="mr-2 shrink-0 text-gray-400" />}
                            <span className="truncate">{doc.title}</span>
                        </button>
                    ))}
                </div>
            ) : (
                /* 文档树 */
                <div className="flex-1 overflow-y-auto px-2 pb-2">
                    <div className="px-3 mb-2 flex justify-between items-center">
                        <span className="text-sm font-semibold text-gray-400 uppercase tracking-wider">知识库</span>
                        <button onClick={addKb} className="p-0.5 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600 transition-colors">
                            <Plus size={14} />
                        </button>
                    </div>

                    {kbs.map(kb => (
                        <div key={kb.id} className="mb-0.5">
                            {/* 知识库行 */}
                            <div className="doco-sidebar-kb-row flex items-center rounded-md px-2 py-2 transition-colors group cursor-pointer"
                                onClick={() => toggleKb(kb.id)}
                                onContextMenu={e => showKbMenu(e, kb)}>
                                <span className="mr-1 text-gray-400">
                                    {expandedKbs[kb.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </span>
                                <Library size={16} className="mr-2 shrink-0" />
                                {editingItem?.type === 'kb' && editingItem.id === kb.id ? (
                                    <InlineEdit value={kb.name}
                                        onSave={v => renameKb(kb.id, v)}
                                        onCancel={() => setEditingItem(null)} />
                                ) : (
                                    <span className="flex-1 truncate text-[17px] font-semibold">{kb.name}</span>
                                )}
                                <button onClick={e => {
                                        e.stopPropagation();
                                        const rect = (e.target as HTMLElement).getBoundingClientRect();
                                        setCtxMenu({
                                            x: rect.left, y: rect.bottom + 2,
                                            items: [
                                                { label: '新建文档', icon: <FileText size={14} />, onClick: () => addDoc(undefined, kb.id) },
                                                { label: '新建电子表格', icon: <Sheet size={14} />, onClick: () => addDoc(undefined, kb.id, 'spreadsheet') },
                                                { label: '新建文件夹', icon: <Folder size={14} />, onClick: () => addFolder(kb.id) },
                                            ]
                                        });
                                    }}
                                    className="p-1 text-gray-400 transition-opacity hover:bg-gray-200 rounded md:opacity-0 md:group-hover:opacity-100">
                                    <Plus size={14} />
                                </button>
                                <button onClick={e => {
                                        e.stopPropagation();
                                        const rect = (e.target as HTMLElement).getBoundingClientRect();
                                        setCtxMenu({
                                            x: rect.left, y: rect.bottom + 2,
                                            items: [
                                                { label: '重命名', icon: <Pencil size={14} />, onClick: () => setEditingItem({ type: 'kb', id: kb.id }) },
                                                { label: '新建文档', icon: <FileText size={14} />, onClick: () => addDoc(undefined, kb.id) },
                                                { label: '新建电子表格', icon: <Sheet size={14} />, onClick: () => addDoc(undefined, kb.id, 'spreadsheet') },
                                                { label: '新建文件夹', icon: <Plus size={14} />, onClick: () => addFolder(kb.id) },
                                                'divider',
                                                { label: '删除', icon: <Trash2 size={14} />, onClick: () => deleteKb(kb.id), danger: true },
                                            ]
                                        });
                                    }}
                                    className="p-1 text-gray-400 transition-opacity hover:bg-gray-200 rounded md:opacity-0 md:group-hover:opacity-100">
                                    <MoreHorizontal size={14} />
                                </button>
                            </div>

                            {/* 知识库内容：文件夹 + 直属文档 */}
                            {expandedKbs[kb.id] && (
                                <div className="doco-sidebar-tree-children">
                                    {(content[`kb_${kb.id}_folders`] || []).map((folder: any) =>
                                        renderFolder(folder, kb.id)
                                    )}
                                    {(content[`kb_${kb.id}_docs`] || []).map((doc: any) =>
                                        renderDoc(doc, undefined, kb.id)
                                    )}
                                </div>
                            )}
                        </div>
                    ))}

                    {kbs.length === 0 && (
                        <div className="px-4 py-8 text-center text-gray-400 text-sm">
                            <Library size={32} className="mx-auto mb-3 text-gray-300" />
                            <p>还没有知识库</p>
                            <button onClick={addKb} className="mt-2 text-blue-500 hover:text-blue-600 text-sm">
                                创建第一个知识库
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* 右键菜单 */}
            {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}

            {/* 移动文档弹窗 */}
            {movingDoc && <MoveDialog kbs={kbs} onMove={(fId, kId) => moveDocTo(fId, kId)} onClose={() => setMovingDoc(null)} />}

            {/* 输入对话框 */}
            {inputDialog && (
                <InputDialog
                    title={inputDialog.title}
                    placeholder={inputDialog.placeholder}
                    onConfirm={inputDialog.onConfirm}
                    onClose={() => setInputDialog(null)}
                />
            )}
        </aside>
    );
};
