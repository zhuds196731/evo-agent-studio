import { useMemo, useRef, useState } from 'react';
import type { AppState, Persona, Position } from '../types';
import Avatar from './Avatar';
import HelpIcon from './HelpIcon';
import OrgChart from './OrgChart';
import { buildAvatarPrompt, compressToAvatar } from '../utils/image';
import { draftPosition } from '../engine/positionFactory';
import { POSITION_CATEGORIES } from '../data/positions';

/** 岗位分类目录固定排序，自定义分类排在后面 */
function categoryOrder(cat: string): number {
  const idx = (POSITION_CATEGORIES as readonly string[]).indexOf(cat);
  return idx >= 0 ? idx : POSITION_CATEGORIES.length;
}

interface Props {
  state: AppState;
  onUpdateState: (patch: Partial<AppState>) => void;
  onCreatePersona: (persona: Persona) => void;
  onToast: (msg: string) => void;
}

export default function PositionCenter({ state, onUpdateState, onCreatePersona, onToast }: Props) {
  const [view, setView] = useState<'manage' | 'org'>('manage');
  const [keyword, setKeyword] = useState('');
  const [editingId, setEditingId] = useState(state.positions[0]?.id ?? '');
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const position = state.positions.find((p) => p.id === editingId);
  const personas = useMemo(
    () => state.personas.filter((p) => p.positionId === editingId),
    [state.personas, editingId],
  );

  const filtered = state.positions.filter(
    (p) =>
      p.name.includes(keyword) ||
      p.department.includes(keyword) ||
      p.skills.some((s) => s.includes(keyword)),
  );

  /** 按分类目录分组，目录按固定顺序排列 */
  const grouped = useMemo(() => {
    const map = new Map<string, Position[]>();
    for (const p of filtered) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return [...map.entries()].sort((a, b) => categoryOrder(a[0]) - categoryOrder(b[0]));
  }, [filtered]);

  const patchPosition = (id: string, patch: Partial<Position>) => {
    onUpdateState({ positions: state.positions.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  };

  const patchPersona = (id: string, patch: Partial<Persona>) => {
    onUpdateState({ personas: state.personas.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  };

  const addPosition = (next: Position) => {
    const persona: Persona = {
      id: `persona-${next.id}`,
      positionId: next.id,
      name: next.name.split(' ')[0] || '新同事',
      avatarMode: 'anime',
      avatarStyle: '二次元细腻写实',
      traits: [],
      temperature: 0.7,
      enabled: true,
    };
    onUpdateState({
      positions: [...state.positions, next],
      personas: [...state.personas, persona],
    });
    setEditingId(next.id);
    setShowAdd(false);
    onToast(`已添加岗位「${next.name}」，可继续编辑职责与形象`);
  };

  const removePosition = (id: string) => {
    if (!window.confirm('删除该岗位会同时移除对应人物，其下属岗位自动上移一层，确定继续？')) return;
    const parentId = state.positions.find((p) => p.id === id)?.reportsTo;
    onUpdateState({
      // 删除后其下属岗位的汇报对象自动上移到被删岗位的上级，保持汇报线连通
      positions: state.positions
        .filter((p) => p.id !== id)
        .map((p) => (p.reportsTo === id ? { ...p, reportsTo: parentId } : p)),
      personas: state.personas.filter((p) => p.positionId !== id),
    });
    if (editingId === id) setEditingId(state.positions[0]?.id ?? '');
  };

  /** 用一句话描述自动生成岗位草稿（配置了模型时由模型产出，否则走规则模板） */
  const generateFromText = async () => {
    const text = draftText.trim();
    if (!text) {
      onToast('请先描述这个岗位，例如：负责海外社媒增长与投放优化');
      return;
    }
    setDrafting(true);
    try {
      const draft = await draftPosition(text, state.llm);
      const id = `pos-gen-${Date.now().toString(36)}`;
      const position: Position = { ...draft, id };
      const persona: Persona = {
        id: `persona-${id}`,
        positionId: id,
        name: draft.name,
        avatarMode: 'anime',
        avatarStyle: '二次元细腻写实',
        traits: [],
        temperature: 0.7,
        enabled: true,
      };
      onUpdateState({
        positions: [...state.positions, position],
        personas: [...state.personas, persona],
      });
      setEditingId(id);
      setDraftText('');
      onToast(`已生成岗位「${draft.name}」，可继续微调`);
    } finally {
      setDrafting(false);
    }
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file || !uploadTarget) return;
    try {
      const url = await compressToAvatar(file);
      patchPersona(uploadTarget, { avatarUrl: url, avatarMode: 'real' });
      onToast('真人头像已更新');
    } catch {
      onToast('图片处理失败，请换一张');
    }
    setUploadTarget(null);
  };

  const copyPrompt = async (persona: Persona, pos?: Position) => {
    const prompt = buildAvatarPrompt({
      name: persona.name,
      position: pos?.name ?? '',
      department: pos?.department ?? '',
      base: pos?.avatarPrompt ?? '',
      style: persona.avatarStyle ?? '',
    });
    try {
      await navigator.clipboard.writeText(prompt);
      onToast('AI 形象提示词已复制，可粘贴到多模态生成');
    } catch {
      onToast(prompt);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2">
      {/* 视图切换：岗位管理 / 组织架构 */}
      <div className="flex gap-1.5">
        {(
          [
            { key: 'manage', label: '岗位管理', icon: '🗂️' },
            { key: 'org', label: '组织架构（汇报关系）', icon: '🏛️' },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`rounded-lg px-3 py-1.5 text-xs transition ${
              view === t.key
                ? 'bg-royal-500/25 text-slate-100 ring-1 ring-royal-500/40'
                : 'text-slate-400 hover:bg-white/5'
            }`}
          >
            <span className="mr-1">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {view === 'org' ? (
        <OrgChart state={state} onUpdateState={onUpdateState} onToast={onToast} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
          <div className="panel flex flex-col overflow-hidden">
            <div className="border-b border-white/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">岗位库</h2>
                <button className="btn-jade px-2 py-1 text-xs" onClick={() => setShowAdd(true)}>
                  + 添加岗位
                </button>
              </div>
          <input
            className="input"
            placeholder="搜索岗位 / 部门 / 技能"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <input
              className="input"
              placeholder="一句话生成岗位：负责海外社媒增长…"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void generateFromText();
              }}
            />
            <button className="btn-primary shrink-0 px-2 py-1 text-xs" onClick={generateFromText} disabled={drafting}>
              {drafting ? '生成中' : 'AI 建岗'}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {grouped.map(([cat, list]) => (
            <div key={cat} className="mb-2">
              <button
                className="flex w-full items-center justify-between rounded-lg bg-white/5 px-2.5 py-1.5 text-left text-[11px] font-medium tracking-wide text-slate-300"
                onClick={() => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }))}
              >
                <span>
                  {collapsed[cat] ? '▸' : '▾'} {cat}
                </span>
                <span className="text-[10px] text-slate-500">{list.length}</span>
              </button>
              {!collapsed[cat] &&
                list.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setEditingId(p.id)}
                    className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                      p.id === editingId
                        ? 'bg-royal-500/20 ring-1 ring-royal-500/40'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <Avatar name={p.name} emoji={p.avatarEmoji} accent={p.accent} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-100">{p.name}</div>
                      <div className="truncate text-[11px] text-slate-500">
                        {p.department} · {p.level}
                      </div>
                    </div>
                  </button>
                ))}
            </div>
          ))}
          {!filtered.length && (
            <div className="p-4 text-center text-xs text-slate-500">没有匹配的岗位</div>
          )}
        </div>
      </div>

          <div className="panel overflow-y-auto p-4">
            {position ? (
              <PositionEditor
                position={position}
                parentName={
                  state.positions.find((p) => p.id === position.reportsTo)?.name ?? ''
                }
                personas={personas}
                onChange={(patch) => patchPosition(position.id, patch)}
                onRemove={() => removePosition(position.id)}
                onPatchPersona={patchPersona}
                onCreatePersona={(p) => onCreatePersona({ ...p, positionId: position.id })}
                onUpload={(pid) => {
                  setUploadTarget(pid);
                  fileRef.current?.click();
                }}
                onCopyPrompt={copyPrompt}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                请选择或新增一个岗位
              </div>
            )}
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPickFile(e.target.files?.[0])}
      />

      {showAdd && (
        <AddPositionForm
          onAdd={addPosition}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

/** 添加岗位表单：名称、分类目录、层级、职责/技能/KPI、语气等完整字段（汇报对象在组织架构中设置） */
function AddPositionForm({
  onAdd,
  onClose,
}: {
  onAdd: (position: Position) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>(POSITION_CATEGORIES[2]);
  const [customCategory, setCustomCategory] = useState('');
  const [department, setDepartment] = useState('');
  const [level, setLevel] = useState('L5');
  const [duties, setDuties] = useState('');
  const [skills, setSkills] = useState('');
  const [kpis, setKpis] = useState('');
  const [tone, setTone] = useState('专业、直接');
  const [emoji, setEmoji] = useState('🧩');

  const finalCategory = category === '自定义' ? customCategory.trim() || '其他' : category;

  const submit = () => {
    if (!name.trim()) return;
    const id = `pos-custom-${Date.now().toString(36)}`;
    const next: Position = {
      id,
      name: name.trim(),
      department: department.trim() || finalCategory,
      category: finalCategory,
      level: level.trim() || 'L5',
      duties: duties.split('\n').map((s) => s.trim()).filter(Boolean),
      skills: skills.split('\n').map((s) => s.trim()).filter(Boolean),
      kpis: kpis.split('\n').map((s) => s.trim()).filter(Boolean),
      tone: tone.trim() || '专业、直接',
      avatarPrompt: `二次元半写实风格职业形象，符合「${name.trim()}」岗位气质，柔和光线，高清细腻`,
      avatarEmoji: emoji || '🧩',
      accent: '#7c9cff',
      builtin: false,
    };
    onAdd(next);
  };

  const linesField = (
    label: string,
    value: string,
    setter: (v: string) => void,
    placeholder: string,
  ) => (
    <div>
      <label className="label">{label}（每行一项）</label>
      <textarea
        className="input min-h-[64px] text-xs"
        value={value}
        onChange={(e) => setter(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="panel max-h-[90vh] w-full max-w-2xl overflow-y-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">添加岗位</h3>
          <button className="btn-ghost text-xs" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">岗位名称 *</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：渠道销售经理"
            />
          </div>
          <div>
            <label className="label">岗位层级</label>
            <input
              className="input"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              placeholder="L1-L10"
            />
          </div>
          <div>
            <label className="label">分类目录</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {POSITION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="自定义">自定义…</option>
            </select>
          </div>
          {category === '自定义' && (
            <div>
              <label className="label">自定义分类名称</label>
              <input
                className="input"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="如：法务类"
              />
            </div>
          )}
          <div>
            <label className="label">所属部门</label>
            <input
              className="input"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="如：销售中心"
            />
          </div>
          {linesField('岗位职责', duties, setDuties, '负责渠道拓展与代理商管理…')}
          {linesField('核心技能', skills, setSkills, '渠道谈判\n区域市场规划…')}
          {linesField('考核指标 KPI', kpis, setKpis, '销售额达成率\n回款率…')}
          <div>
            <label className="label">沟通风格 / 语气</label>
            <textarea
              className="input min-h-[64px] text-xs"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
            />
          </div>
          <div>
            <label className="label">图标 Emoji</label>
            <input
              className="input"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              maxLength={4}
            />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button className="btn-primary text-xs" onClick={submit} disabled={!name.trim()}>
            保存并添加
          </button>
          <button className="btn-ghost text-xs" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

interface EditorProps {
  position: Position;
  parentName: string;
  personas: Persona[];
  onChange: (patch: Partial<Position>) => void;
  onRemove: () => void;
  onPatchPersona: (id: string, patch: Partial<Persona>) => void;
  onCreatePersona: (persona: Persona) => void;
  onUpload: (personaId: string) => void;
  onCopyPrompt: (persona: Persona, position?: Position) => void;
}

function PositionEditor({
  position,
  parentName,
  personas,
  onChange,
  onRemove,
  onPatchPersona,
  onCreatePersona,
  onUpload,
  onCopyPrompt,
}: EditorProps) {
  const listField = (
    value: string[],
    key: 'duties' | 'skills' | 'kpis',
    placeholder: string,
    hint: string,
  ) => (
    <div>
      <label className="label flex items-center">
        {placeholder}
        <HelpIcon label={placeholder} text={hint} />
      </label>
      <textarea
        className="input min-h-[64px] text-xs"
        value={value.join('\n')}
        onChange={(e) => onChange({ [key]: e.target.value.split('\n').filter(Boolean) } as Partial<Position>)}
      />
      <div className="mt-1 text-[11px] text-slate-500">每行一项</div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={position.name} emoji={position.avatarEmoji} accent={position.accent} size={56} ring />
          <div>
            <input
              className="w-64 bg-transparent text-lg font-semibold text-slate-100 outline-none"
              value={position.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
            <div className="mt-1 flex gap-2">
              <select
                className="w-24 rounded border border-white/10 bg-ink-700/60 px-2 py-1 text-xs"
                value={position.category ?? ''}
                onChange={(e) => onChange({ category: e.target.value })}
                title="分类目录"
              >
                {[...new Set([position.category ?? '其他', ...POSITION_CATEGORIES, '其他'])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                className="w-28 rounded border border-white/10 bg-ink-700/60 px-2 py-1 text-xs"
                value={position.department}
                onChange={(e) => onChange({ department: e.target.value })}
              />
              <input
                className="w-16 rounded border border-white/10 bg-ink-700/60 px-2 py-1 text-xs"
                value={position.level}
                onChange={(e) => onChange({ level: e.target.value })}
              />
            </div>
          </div>
        </div>
        <button className="btn-ghost text-xs text-rose-300" onClick={onRemove}>
          删除岗位
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">主题色</label>
          <input
            type="color"
            className="h-[38px] w-full rounded-lg border border-white/10 bg-ink-700/60"
            value={position.accent}
            onChange={(e) => onChange({ accent: e.target.value })}
          />
        </div>
        <div className="md:col-span-2 rounded-lg border border-white/5 bg-ink-700/40 px-3 py-2 text-[11px] text-slate-400">
          汇报对象：{parentName ? (
            <span className="text-slate-200">{parentName}</span>
          ) : (
            <span className="text-amber-300">最高负责人</span>
          )}
          {' · '}如需调整上级，请前往本页顶部的「组织架构（汇报关系）」视图，汇报/问询场景将按该结构自动配对。
        </div>
        {listField(
          position.duties,
          'duties',
          '岗位职责',
          '该岗位日常负责的工作事项，一行一条。会写入人物的人设提示词，直接影响对话中的立场与回答内容。建议 3~6 条，写具体、可衡量的工作，避免空泛。',
        )}
        {listField(
          position.skills,
          'skills',
          '核心技能',
          '胜任该岗位所需的专业能力，一行一项。对话时会体现为专业术语与表达方式，同时也是插件能力匹配的依据之一。',
        )}
        {listField(
          position.kpis,
          'kpis',
          '考核指标 KPI',
          '衡量岗位产出的量化指标。「汇报」「问询」场景会围绕这些指标组织内容，请填写可量化的数值型指标。',
        )}
        <div>
          <label className="label flex items-center">
            沟通风格 / 语气
            <HelpIcon
              label="沟通风格"
              text="人物说话的语气与表达习惯，例：「结论先行、数据化表达」「温和但原则清晰」。直接决定对话读起来的感觉。"
            />
          </label>
          <textarea
            className="input min-h-[64px] text-xs"
            value={position.tone}
            onChange={(e) => onChange({ tone: e.target.value })}
          />
        </div>
        <div>
          <label className="label flex items-center">
            AI 形象外观描述
            <HelpIcon
              label="AI 形象外观"
              text="生成 AI 头像时使用的文字描述，包含画风、穿着、场景等要素。点击人物卡片的「复制 AI 形象提示词」后会自动拼接成完整提示词。"
            />
          </label>
          <textarea
            className="input min-h-[64px] text-xs"
            value={position.avatarPrompt}
            onChange={(e) => onChange({ avatarPrompt: e.target.value })}
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/5 bg-ink-700/40 p-3">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">岗位人物</h3>
          <button
            className="btn-ghost text-xs"
            onClick={() =>
              onCreatePersona({
                id: `persona-${position.id}-${Date.now().toString(36)}`,
                positionId: position.id,
                name: `${position.name.split(' ')[0]}·新`,
                avatarMode: 'anime',
                avatarStyle: '二次元细腻写实',
                traits: [],
                temperature: 0.7,
                enabled: true,
              })
            }
          >
            + 增加同名岗位人员
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {personas.map((persona) => (
            <div
              key={persona.id}
              className="rounded-xl border border-white/5 bg-ink-800/70 p-3"
            >
              <div className="flex items-center gap-3">
                <Avatar
                  name={persona.name}
                  url={persona.avatarUrl}
                  emoji={position.avatarEmoji}
                  accent={position.accent}
                  size={52}
                  ring
                />
                <div className="flex-1">
                  <input
                    className="w-full bg-transparent text-sm font-medium text-slate-100 outline-none"
                    value={persona.name}
                    onChange={(e) => onPatchPersona(persona.id, { name: e.target.value })}
                  />
                  <div className="mt-1 text-[11px] text-slate-500">
                    {position.name} · {persona.avatarMode === 'real' ? '真人形象' : '二次元形象'}
                  </div>
                </div>
                <label className="flex items-center gap-1 text-[11px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={persona.enabled}
                    onChange={(e) => onPatchPersona(persona.id, { enabled: e.target.checked })}
                  />
                  启用
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-ghost px-2 py-1 text-[11px]" onClick={() => onUpload(persona.id)}>
                  上传真人头像
                </button>
                <button className="btn-ghost px-2 py-1 text-[11px]" onClick={() => onCopyPrompt(persona, position)}>
                  复制 AI 形象提示词
                </button>
                <button
                  className="btn-ghost px-2 py-1 text-[11px]"
                  onClick={() => onPatchPersona(persona.id, { avatarUrl: undefined, avatarMode: 'anime' })}
                >
                  恢复默认形象
                </button>
              </div>
              <div className="mt-3">
                <label className="label flex items-center">
                  附加人格特征
                  <HelpIcon
                    label="附加人格特征"
                    text="在同岗位人物上叠加的个人特质，每行一条（例：「性格急躁」「喜欢引用数据」），会覆盖岗位默认语气，让同名岗位的多人有差异化个性。"
                  />
                  <span className="ml-1 text-[10px] text-slate-500">每行一项，覆盖岗位语气</span>
                </label>
                <textarea
                  className="input min-h-[52px] text-xs"
                  value={persona.traits.join('\n')}
                  onChange={(e) =>
                    onPatchPersona(persona.id, {
                      traits: e.target.value.split('\n').filter(Boolean),
                    })
                  }
                />
              </div>
              <div className="mt-2">
                <label className="label flex items-center">
                  发散度 {persona.temperature.toFixed(1)}
                  <HelpIcon
                    label="发散度"
                    text="控制回答的随机性与创造力：0 = 最严谨稳定，适合汇报、数据分析类场景；1 = 最有创造力，适合文案、头脑风暴。日常建议 0.5~0.8。"
                  />
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={persona.temperature}
                  className="w-full"
                  onChange={(e) =>
                    onPatchPersona(persona.id, { temperature: Number(e.target.value) })
                  }
                />
              </div>
            </div>
          ))}
          {!personas.length && (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-500">
              该岗位还没有人物，可点击上方按钮添加
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
