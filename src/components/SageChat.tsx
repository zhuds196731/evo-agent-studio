import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, LlmConfig, Sage, Session } from '../types';
import Avatar from './Avatar';
import { routeModel } from '../engine/providers';
import { runTurn } from '../engine/director';
import { newMessage, newSession } from '../store/storage';
import LlmSetupModal from './LlmSetupModal';

interface Props {
  state: AppState;
  onUpdateState: (patch: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string) => void;
  sage: Sage;
}

/** 找出该先哲已有的问策会话（取最近一条），没有则返回 null */
function findConsultSession(sessions: Session[], sageId: string): Session | null {
  const match = sessions
    .filter((s) => s.scene === 'consult' && s.participantIds[0] === sageId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return match[0] ?? null;
}

function upsert(sessions: Session[], next: Session): Session[] {
  return sessions.some((s) => s.id === next.id)
    ? sessions.map((s) => (s.id === next.id ? next : s))
    : [next, ...sessions];
}

/**
 * 先哲堂内嵌的问策对话。
 * 会话本身存在 state.sessions（scene='consult'），与「协同会话」页共用同一批数据，
 * 因此在两个入口看到的对话历史是同一份，不会各存一份。
 */
export default function SageChat({ state, onUpdateState, onToast, sage }: Props) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const routedModel = useMemo(() => routeModel(state.llm, state.providerKeys ?? {}), [state.llm, state.providerKeys]);
  const hasModel = Boolean(routedModel);

  const session = useMemo(
    () => findConsultSession(state.sessions, sage.id),
    [state.sessions, sage.id],
  );
  const messages = session?.messages ?? [];

  // 切换先哲时清掉未发送的草稿，避免串场
  useEffect(() => {
    setDraft('');
  }, [sage.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy]);

  const ensureSession = (): Session => {
    const found = findConsultSession(state.sessions, sage.id);
    if (found) return { ...found, messages: [...found.messages] };
    return newSession({
      title: `问策 · ${sage.name}`,
      scene: 'consult',
      participantIds: [sage.id],
      webMode: 'online',
    });
  };

  const runSend = async (text: string, overrides?: { llm?: LlmConfig; providerKeys?: Record<string, string> }) => {
    const working = ensureSession();
    working.messages.push(newMessage(working.id, 'me', '我', text, 'user'));
    const runState: AppState = {
      ...state,
      sessions: upsert(state.sessions, working),
      llm: overrides?.llm ?? state.llm,
      providerKeys: overrides?.providerKeys ?? state.providerKeys,
    };

    onUpdateState((prev) => ({
      sessions: upsert(prev.sessions, { ...working }),
      activeSessionId: working.id,
    }));
    setBusy(true);
    try {
      await runTurn(runState, working, text);
      onUpdateState((prev) => ({
        sessions: upsert(prev.sessions, { ...working }),
        activeSessionId: working.id,
      }));
    } catch (error) {
      onToast(`本轮生成失败：${(error as Error)?.message ?? '请重试'}`);
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    if (!hasModel) {
      setPending(text);
      setShowSetup(true);
      return;
    }
    void runSend(text);
  };

  const toggleWebMode = () => {
    if (!session) return;
    const next = session.webMode === 'offline' ? 'online' : 'offline';
    onUpdateState((prev) => ({
      sessions: prev.sessions.map((s) => (s.id === session.id ? { ...s, webMode: next } : s)),
    }));
  };

  const clearChat = () => {
    if (!session) return;
    if (!window.confirm(`清空与「${sage.name}」的问策记录？此操作不可恢复。`)) return;
    onUpdateState((prev) => ({
      sessions: prev.sessions.map((s) => (s.id === session.id ? { ...s, messages: [] } : s)),
    }));
    onToast('问策记录已清空');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
        <Avatar name={sage.name} url={sage.avatarUrl} emoji={sage.emoji} accent={sage.accent} size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-slate-200">
            向 {sage.name} 问策
          </div>
          <div className="text-[10px] text-slate-500">
            {hasModel ? `真实模型 ${routedModel?.model.name ?? ''}` : '未配置模型'}
            {session ? ` · ${session.webMode === 'offline' ? '离线' : '联网'}研究` : ''}
          </div>
        </div>
        {session && (
          <>
            <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={toggleWebMode}>
              {session.webMode === 'offline' ? '切联网' : '切离线'}
            </button>
            <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={clearChat}>
              清空
            </button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {!messages.length && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="text-2xl">{sage.emoji}</div>
            <div className="text-xs text-slate-400">
              向{sage.name}提出你的困惑
            </div>
            <div className="max-w-sm text-[11px] leading-relaxed text-slate-500">
              擅长：{sage.goodAt.join('、') || '—'}
            </div>
          </div>
        )}
        {messages.map((m) => {
          const mine = m.role === 'user';
          const system = m.role === 'system';
          if (system) {
            return (
              <div key={m.id} className="text-center text-[10px] text-slate-600">
                {m.content}
              </div>
            );
          }
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
              {!mine && (
                <Avatar name={sage.name} url={sage.avatarUrl} emoji={sage.emoji} accent={sage.accent} size={26} />
              )}
              <div
                className={`max-w-[78%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                  mine
                    ? 'bg-royal-500/20 text-slate-100'
                    : 'border border-white/5 bg-ink-700/50 text-slate-200'
                }`}
              >
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-royal-400" />
            {sage.name}正在作答…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-white/5 p-3">
        {!hasModel && (
          <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
            当前未配置模型：发送问话时会自动打开 API 设置窗口，保存后会自动继续。
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            className="input min-h-[52px] flex-1 text-xs"
            placeholder={`向${sage.name}提问…（Enter 发送，Shift+Enter 换行）`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="btn-primary shrink-0 px-3 py-2 text-xs" onClick={send} disabled={busy || !draft.trim()}>
            {busy ? '作答中…' : '发送'}
          </button>
        </div>
      </div>

      {showSetup && (
        <LlmSetupModal
          state={state}
          onUpdateState={onUpdateState}
          onClose={() => {
            setShowSetup(false);
            setPending(null);
          }}
          onSaved={(llm, providerKeys) => {
            setShowSetup(false);
            const text = pending;
            setPending(null);
            if (text) void runSend(text, { llm, providerKeys });
          }}
          title="配置大模型以开始问策"
          description="保存 API 参数后会自动继续刚才的问话。"
        />
      )}
    </div>
  );
}
