import React, { useState, useEffect } from 'react';
import { Folder, FileText, ChevronRight, ChevronDown, Plus, Library } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

const API_BASE = 'http://127.0.0.1:8000/api';

export const Sidebar = () => {
    const [kbs, setKbs] = useState<any[]>([]);
    const [expandedKbs, setExpandedKbs] = useState<Record<number, boolean>>({});
    const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({});
    const [content, setContent] = useState<Record<string, any[]>>({});
    const navigate = useNavigate();

    useEffect(() => {
        fetchKbs();
    }, []);

    const fetchKbs = async () => {
        try {
            console.log('[Sidebar] Fetching Knowledge Bases...');
            const res = await fetch(`${API_BASE}/kb`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            console.log('[Sidebar] KBs fetched:', data);
            setKbs(data);
        } catch (e) {
            console.error('[Sidebar] Failed to fetch KBs:', e);
        }
    };

    const toggleKb = async (kbId: number) => {
        setExpandedKbs(prev => ({ ...prev, [kbId]: !prev[kbId] }));
        if (!content[`kb_${kbId}`]) {
            try {
                const res = await fetch(`${API_BASE}/kb/${kbId}/folders`);
                const folders = await res.json();
                setContent(prev => ({ ...prev, [`kb_${kbId}`]: folders }));
            } catch (e) {
                console.error('Failed to fetch folders', e);
            }
        }
    };

    const toggleFolder = async (folderId: number) => {
        setExpandedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));
        if (!content[`folder_${folderId}`]) {
            try {
                const res = await fetch(`${API_BASE}/folders/${folderId}/docs`);
                const docs = await res.json();
                setContent(prev => ({ ...prev, [`folder_${folderId}`]: docs }));
            } catch (e) {
                console.error('Failed to fetch docs', e);
            }
        }
    };

    const addKb = async () => {
        const name = prompt('请输入知识库名称:');
        if (!name) return;
        try {
            const res = await fetch(`${API_BASE}/kb`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (res.ok) {
                console.log('KB added successfully');
                await fetchKbs();
            } else {
                const err = await res.text();
                alert(`创建失败: ${err}`);
            }
        } catch (e) {
            console.error('Failed to add KB', e);
            alert('网络错误，请稍后重试');
        }
    };

    const addFolder = async (kbId: number) => {
        const name = prompt('请输入文件夹名称:');
        if (!name) return;
        try {
            const res = await fetch(`${API_BASE}/folders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, kb_id: kbId })
            });
            if (res.ok) {
                console.log('[Sidebar] Folder added successfully');
                const resFolders = await fetch(`${API_BASE}/kb/${kbId}/folders`);
                const folders = await resFolders.json();
                setContent(prev => ({ ...prev, [`kb_${kbId}`]: folders }));
                setExpandedKbs(prev => ({ ...prev, [kbId]: true }));
            } else {
                alert('创建文件夹失败');
            }
        } catch (e) {
            console.error('[Sidebar] Failed to add folder', e);
        }
    };

    const addDoc = async (folderId: number) => {
        const title = prompt('请输入文档标题:');
        if (!title) return;
        const docId = `doc_${Math.random().toString(36).substr(2, 9)}`;
        try {
            const res = await fetch(`${API_BASE}/docs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: docId, title, folder_id: folderId })
            });
            if (res.ok) {
                console.log('[Sidebar] Doc added successfully');
                const resDocs = await fetch(`${API_BASE}/folders/${folderId}/docs`);
                const docs = await resDocs.json();
                setContent(prev => ({ ...prev, [`folder_${folderId}`]: docs }));
                setExpandedFolders(prev => ({ ...prev, [folderId]: true }));
                navigate(`/doc/${docId}`);
            } else {
                alert('创建文档失败');
            }
        } catch (e) {
            console.error('[Sidebar] Failed to add doc:', e);
            alert('网络错误');
        }
    };

    return (
        <div className="w-64 bg-[#f9f9f9] border-r border-gray-200 h-full flex flex-col pt-4 select-none">
            <div className="px-5 mb-4 flex justify-between items-center">
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">知识库</h2>
                <button onClick={addKb} className="p-1 hover:bg-gray-200 rounded text-gray-500 transition-colors">
                    <Plus size={16} />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2">
                {kbs.map(kb => (
                    <div key={kb.id} className="mb-1">
                        <div
                            className="flex items-center px-3 py-1.5 hover:bg-gray-200 group cursor-pointer rounded-md transition-colors"
                            onClick={() => toggleKb(kb.id)}
                        >
                            <Library size={16} className="mr-2 text-indigo-500" />
                            <span className="flex-1 text-sm truncate font-medium text-gray-700">{kb.name}</span>
                            <button
                                onClick={(e) => { e.stopPropagation(); addFolder(kb.id); }}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-300 rounded text-gray-500 transition-opacity"
                            >
                                <Plus size={14} />
                            </button>
                            <span className="ml-1 text-gray-400">
                                {expandedKbs[kb.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </span>
                        </div>
                        {expandedKbs[kb.id] && content[`kb_${kb.id}`] && (
                            <div className="ml-4 mt-1 space-y-1">
                                {content[`kb_${kb.id}`].map(folder => (
                                    <div key={folder.id}>
                                        <div
                                            className="flex items-center px-3 py-1.5 hover:bg-gray-200 group cursor-pointer rounded-md transition-colors"
                                            onClick={() => toggleFolder(folder.id)}
                                        >
                                            <Folder size={14} className="mr-2 text-amber-500" />
                                            <span className="flex-1 text-xs truncate font-medium text-gray-600">{folder.name}</span>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); addDoc(folder.id); }}
                                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-300 rounded text-gray-500 transition-opacity"
                                            >
                                                <Plus size={12} />
                                            </button>
                                            <span className="ml-1 text-gray-400">
                                                {expandedFolders[folder.id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                            </span>
                                        </div>
                                        {expandedFolders[folder.id] && content[`folder_${folder.id}`] && (
                                            <div className="ml-4 mt-1 space-y-1">
                                                {content[`folder_${folder.id}`].map(doc => (
                                                    <Link
                                                        key={doc.id}
                                                        to={`/doc/${doc.id}`}
                                                        className="flex items-center px-3 py-1.5 hover:bg-gray-200 text-xs text-gray-500 rounded-md transition-colors no-underline"
                                                    >
                                                        <FileText size={12} className="mr-2 text-gray-400" />
                                                        <span className="truncate">{doc.title}</span>
                                                    </Link>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};
