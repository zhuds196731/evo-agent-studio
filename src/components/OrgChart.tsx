import { useMemo } from 'react';
import type { AppState, Position } from '../types';
import Avatar from './Avatar';

/**
 * 组织架构：以树形展示全部岗位的汇报线。
 * 汇报对象在此统一调整（岗位编辑表单不再承担），自动跟随岗位增删：
 * - 列表实时来自现有岗位，新增岗位立即出现在可选上级中
 * - 删除岗位时其下属自动上移一层（PositionCenter.removePosition 保证）
 * - 悬挂引用（上级已被删）自动视为最高负责人
 * - 上级选择排除自身与全部下属，杜绝汇报环
 */

interface Props {
  state: AppState;
  onUpdateState: (patch: Partial<AppState>) => void;
  onToast: (msg: string) => void;
}

export default function OrgChart({ state, onUpdateState, onToast }: Props) {
  const positions = state.positions;

  /** 上级有效性：存在且非自身；悬挂引用视为无上级 */
  const effectiveParent = (p: Position): string | undefined =>
    p.reportsTo && p.reportsTo !== p.id && positions.some((x) => x.id === p.reportsTo)
      ? p.reportsTo
      : undefined;

  const childrenMap = useMemo(() => {
    const map = new Map<string, Position[]>();
    for (const p of positions) {
      const key = effectiveParent(p) ?? '__root__';
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.level.localeCompare(b.level) || a.name.localeCompare(b.name, 'zh-CN'));
    }
    return map;
  }, [positions]);

  /** 判断 candidateId 是否是 posId 的（间接）下属，防止形成汇报环 */
  const isDescendant = (posId: string, candidateId: string): boolean => {
    let current = effectiveParent(positions.find((p) => p.id === candidateId) ?? ({} as Position));
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (current === posId) return true;
      seen.add(current);
      current = effectiveParent(positions.find((p) => p.id === current) ?? ({} as Position));
    }
    return false;
  };

  const changeParent = (posId: string, parentId: string) => {
    if (parentId === posId) return;
    if (parentId && isDescendant(posId, parentId)) {
      onToast('不能把下属选为上级，会形成汇报环');
      return;
    }
    onUpdateState({
      positions: positions.map((p) =>
        p.id === posId ? { ...p, reportsTo: parentId || undefined } : p,
      ),
    });
    onToast('汇报关系已更新');
  };

  const nameOf = (id: string) => positions.find((p) => p.id === id)?.name ?? '';

  const renderNode = (pos: Position, depth: number) => {
    const children = childrenMap.get(pos.id) ?? [];
    const parentName = effectiveParent(pos) ? nameOf(effectiveParent(pos)!) : '';
    // 可选上级：除自己与全部（直接+间接）下属外的所有岗位
    const selectable = positions.filter(
      (p) => p.id !== pos.id && !isDescendant(pos.id, p.id),
    );
    const isRoot = !effectiveParent(pos);

    return (
      <div key={pos.id}>
        <div
          className={`flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-ink-800/70 px-3 py-2 ${
            depth > 0 ? 'ml-6' : ''
          }`}
          style={{ marginTop: depth > 0 ? 6 : 0 }}
        >
          <Avatar name={pos.name} emoji={pos.avatarEmoji} accent={pos.accent} size={34} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm text-slate-100">{pos.name}</span>
              {isRoot && (
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                  最高负责人
                </span>
              )}
            </div>
            <div className="truncate text-[11px] text-slate-500">
              {pos.category} · {pos.department} · {pos.level}
              {children.length > 0 && ` · 下属 ${children.length} 个岗位`}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-500">汇报对象</span>
            {isRoot ? (
              <select
                className="w-36 rounded border border-white/10 bg-ink-700/70 px-2 py-1 text-[11px] text-slate-300"
                value=""
                onChange={(e) => changeParent(pos.id, e.target.value)}
                title="最高负责人也可挂到其他岗位下（如董事长挂到董事会岗位）"
              >
                <option value="">—（最高负责人）</option>
                {selectable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                className="w-36 rounded border border-white/10 bg-ink-700/70 px-2 py-1 text-[11px] text-slate-300"
                value={effectiveParent(pos)}
                onChange={(e) => changeParent(pos.id, e.target.value)}
                title={parentName ? `当前上级：${parentName}` : ''}
              >
                {selectable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        {children.length > 0 && (
          <div className="relative ml-3 border-l border-white/10 pl-2">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const roots = childrenMap.get('__root__') ?? [];

  return (
    <div className="panel h-full overflow-y-auto p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-200">组织架构 · 汇报关系</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          全公司汇报线一目了然，汇报对象的调整统一在这里进行（岗位编辑表单只维护职责与形象）。
          下拉列表自动跟随岗位增删：新增岗位立即可选，删除岗位后其下属自动上移一层。
          汇报/问询场景将按此结构自动配对上下级。
        </p>
      </div>

      {roots.length ? (
        <div className="space-y-2">{roots.map((p) => renderNode(p, 0))}</div>
      ) : (
        <div className="py-10 text-center text-xs text-slate-500">
          暂无岗位，请先在「岗位管理」中添加
        </div>
      )}
    </div>
  );
}
