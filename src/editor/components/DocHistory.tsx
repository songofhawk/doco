import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Clock, RotateCcw, Archive } from 'lucide-react';

interface HistoryVersion {
  id: number;
  created_at: string;
}


interface DocHistoryProps {
  docId: string;
  onClose: () => void;
  onRestore: () => void;
}

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000/api';

export function DocHistory({ docId, onClose, onRestore }: DocHistoryProps) {
  const [versions, setVersions] = useState<HistoryVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [compacting, setCompacting] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const loadVersions = () => {
    setLoading(true);
    fetch(`${API_BASE}/docs/${docId}/history`)
      .then(res => res.json())
      .then(data => {
        setVersions(data);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadVersions();
  }, [docId]);

  const handleRestore = async (updateId: number) => {
    if (!confirm('确定要恢复到此版本吗？当前内容将被覆盖。')) return;

    await fetch(`${API_BASE}/docs/${docId}/restore/${updateId}`, {
      method: 'POST'
    });

    onRestore();
    onClose();
  };

  const handleCompact = async () => {
    if (!confirm('压缩会合并所有历史记录为一个快照，确定继续？')) return;
    setCompacting(true);
    try {
      await fetch(`${API_BASE}/docs/${docId}/compact`, { method: 'POST' });
      loadVersions();
    } finally {
      setCompacting(false);
    }
  };

  const handleDateJump = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value;
    setSelectedDate(date);
    if (!date) return;

    const [year, month, day] = date.split('-').map(Number);
    const targetDate = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();

    const idx = versions.findIndex(v => new Date(v.created_at).getTime() <= targetDate);

    if (idx >= 0 && listRef.current) {
      const container = listRef.current.querySelector('.space-y-3');
      const item = container?.children[idx] as HTMLElement;
      item?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      item?.classList.add('ring-2', 'ring-blue-500');
      setTimeout(() => item?.classList.remove('ring-2', 'ring-blue-500'), 2000);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-xl w-[600px] max-h-[700px] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">文档历史</h2>
              <p className="text-xs text-gray-500">{versions.length} 个版本</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="flex items-center gap-3 px-6 py-4 bg-gray-50/50">
          <input
            type="date"
            value={selectedDate}
            onChange={handleDateJump}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleCompact}
            disabled={compacting || versions.length <= 1}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Archive className="w-4 h-4" />
            {compacting ? '压缩中...' : '压缩'}
          </button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-gray-400">加载中...</div>
            </div>
          ) : versions.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-gray-400">暂无历史记录</div>
            </div>
          ) : (
            <div className="space-y-3">
              {versions.map((v, idx) => {
                const date = new Date(v.created_at);
                const isToday = date.toDateString() === new Date().toDateString();
                return (
                  <div
                    key={v.id}
                    className="group flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-all"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-sm font-semibold text-gray-600">
                        {idx === 0 ? '最新' : `#${versions.length - idx}`}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {idx === 0 ? '当前版本' : isToday ? '今天' : date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                    {idx > 0 && (
                      <button
                        onClick={() => handleRestore(v.id)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <RotateCcw className="w-4 h-4" />
                        恢复
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
