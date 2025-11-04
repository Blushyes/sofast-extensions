import { useCallback, useEffect, useMemo, useState } from 'react';
import { Context, LocalStorage } from '@sofastapp/api';
import { CheckCircle2, Circle, ListTodo } from 'lucide-react';
import { List } from '@sofastapp/react-components';
import type { ListItem } from '@sofastapp/react-components';

interface TodoItem {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'plugin.todolist.items';

function useCmd() {
  return useMemo(
    () => new URLSearchParams(location.search).get('cmd') || '',
    [],
  );
}

function useSid() {
  return useMemo(
    () => new URLSearchParams(location.search).get('sid') || '',
    [],
  );
}

function ListView() {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const persist = useCallback(async (next: TodoItem[]) => {
    setItems(next);
    try {
      await LocalStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const list = (await LocalStorage.getItem<TodoItem[]>(STORAGE_KEY)) ?? [];
      setItems(Array.isArray(list) ? list : []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    (async () => {
      const v = await Context.getSearchContent();
      setQuery(v || '');
    })();
    const unref = Context.watchSearchContent((v: string) => {
      setQuery(v || '');
    });
    return () => unref?.();
  }, []);

  useEffect(() => {
    // Clamp selection against the visible flattened count (todo + done)
    const visibleCount = items.length;
    if (selected > Math.max(visibleCount - 1, 0)) {
      setSelected(Math.max(visibleCount - 1, 0));
    }
  }, [items.length, selected]);

  const addFromSearch = useCallback(
    async (textOverride?: string) => {
      const t = (textOverride ?? query ?? '').trim();
      if (!t) return;
      const now = Date.now();
      const newItem: TodoItem = {
        id: Math.random().toString(36).slice(2),
        title: t,
        done: false,
        createdAt: now,
        updatedAt: now,
      };
      const next = [newItem, ...items];
      await persist(next);
      // Keep visual selection on the previous item (shift by +1 since we unshifted)
      setSelected((prev) => Math.min(prev + 1, next.length - 1));
      await Context.clearSearchContent();
      setQuery('');
    },
    [items, persist, query],
  );

  const createTodo = useCallback(async () => {
    const v = await Context.getSearchContent();
    const t = (v ?? query ?? '').trim();
    if (!t) return;
    await addFromSearch(t);
  }, [addFromSearch, query]);

  const toggleDone = async (id: string) => {
    const next = items.map((it) =>
      it.id === id ? { ...it, done: !it.done, updatedAt: Date.now() } : it,
    );
    await persist(next);
  };

  const current = useMemo(
    () => items.find((it) => it.id === currentId),
    [items, currentId],
  );

  const deleteCurrent = async () => {
    const cur = current;
    if (!cur) return;
    const next = items.filter((it) => it.id !== cur.id);
    await persist(next);
    setSelected((prev) => Math.max(0, Math.min(prev, next.length - 1)));
  };

  // 旧的 prompt 编辑逻辑已废弃（通过 enterEditMode + commitEdit 处理）

  // 进入编辑模式（用于 Ctrl+E 或从 action-panel 选择“编辑”）
  const enterEditMode = useCallback(async () => {
    const cur = current;
    if (!cur) return;
    setEditing(true);
    await Context.clearSearchContent();
    await Context.setSearchContent(cur.title);
  }, [current]);

  // 确认编辑：将当前选中待办标题改为搜索框内容
  const commitEdit = useCallback(async () => {
    const cur = current;
    if (!cur) return;
    const v = await Context.getSearchContent();
    const t = (v || '').trim();
    if (!t) return;
    const next = items.map((it) =>
      it.id === cur.id ? { ...it, title: t, updatedAt: Date.now() } : it,
    );
    await persist(next);
    await Context.clearSearchContent();
    setEditing(false);
  }, [items, current, persist]);

  const deleteAllTodos = useCallback(async () => {
    if (items.length === 0) return;
    await persist([]);
    setSelected(0);
  }, [items.length, persist]);

  // 移除本地 Enter 处理，交由 Footer 的 button(keys=[Enter]) 统一触发

  // 注册 Footer 按钮（显示 Ctrl/Cmd + K）
  useEffect(() => {
    // TODO 后续插件API来提供判断平台的api
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    (async () => {
      const isEmpty = items.length === 0;
      const actionPanelItems: any[] = [
        {
          id: 'create',
          name: '创建待办',
          icon: 'Plus',
          onSelect: createTodo,
        },
        {
          id: 'deleteAll',
          name: '删除所有待办',
          icon: 'Trash2',
          color: '#ef4444',
          keys: ['Ctrl', 'L'],
          onSelect: deleteAllTodos,
        },
      ];
      if (!isEmpty) {
        actionPanelItems.push({
          id: 'edit',
          name: '编辑',
          icon: 'Edit3',
          keys: ['Ctrl', 'E'],
          onSelect: enterEditMode,
        });
        actionPanelItems.push({
          id: 'delete',
          name: '删除',
          icon: 'Trash2',
          color: '#ef4444',
          keys: ['Ctrl', 'X'],
          onSelect: deleteCurrent,
        });
      }
      // 计算 Enter 按钮动态行为与文案
      const cur = current;
      const hasQuery = (query || '').trim().length > 0;
      const enterLabel = editing
        ? '确认编辑'
        : hasQuery
          ? '创建待办'
          : cur
            ? cur.done
              ? '设置为未完成'
              : '设置为已完成'
            : '创建待办';
      const enterAction = editing
        ? commitEdit
        : hasQuery
          ? createTodo
          : cur
            ? () => toggleDone(cur.id)
            : createTodo;

      await Context.setFooter([
        // 顺序注意：由于宿主对右侧 Footer 有 reverse 渲染，此处先放 action-panel、再放 create，确保展示为 [创建, 操作]
        {
          id: 'action-panel',
          type: 'action-panel',
          label: '操作',
          keys: [isMac ? 'Cmd' : 'Ctrl', 'K'],
          title: current?.title || '',
          items: actionPanelItems,
        },
        {
          type: 'button',
          id: 'enter-action',
          label: enterLabel,
          // 使用 Enter 作为快捷键（宿主会匹配 'enter' 或 '↵'）
          keys: ['↵'],
          onClick: enterAction,
        },
      ] as any);
    })();
  }, [
    current,
    selected,
    items,
    createTodo,
    deleteAllTodos,
    enterEditMode,
    deleteCurrent,
    query,
    editing,
    commitEdit,
  ]);

  return (
    <div className="h-full w-full flex flex-col items-center px-4 pt-2 text-sm">
      <div className="w-full">
        {items.length === 0 ? (
          <div className="min-h-[40vh] flex flex-col items-center justify-center text-center">
            <ListTodo className="w-12 h-12 text-neutral-300 dark:text-neutral-600 mb-2" />
            <div className="text-sm text-neutral-500 dark:text-neutral-400">
              暂无待办，去创建一个吧
            </div>
          </div>
        ) : (
          (() => {
            const todoItems = items
              .filter((it) => !it.done)
              .map<ListItem>((it) => ({
                id: it.id,
                name: it.title,
                subtitle: `添加于 ${new Date(it.createdAt).toLocaleTimeString()}`,
                icon: <Circle className="w-5 h-5" />,
              }));
            const doneItems = items
              .filter((it) => it.done)
              .map<ListItem>((it) => ({
                id: it.id,
                name: it.title,
                subtitle: `添加于 ${new Date(it.createdAt).toLocaleTimeString()}`,
                icon: <CheckCircle2 className="w-5 h-5" />,
              }));
            const flat = [...todoItems, ...doneItems];
            return (
              <List
                items={flat}
                groups={[
                  { label: 'Todo', items: todoItems },
                  { label: 'Completed', items: doneItems },
                ]}
                initialIndex={selected}
                onIndexChange={(i, it) => {
                  setSelected(i);
                  const id =
                    typeof it?.id === 'string'
                      ? (it?.id as string)
                      : it?.id
                        ? String(it?.id)
                        : null;
                  setCurrentId(id);
                }}
                onClickItem={(it) => {
                  const id =
                    typeof it.id === 'string' ? it.id : String(it.id || '');
                  if (id) void toggleDone(id);
                }}
              />
            );
          })()
        )}
      </div>
    </div>
  );
}

export default function App() {
  useSid();
  return <ListView />;
}
