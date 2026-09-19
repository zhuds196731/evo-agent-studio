import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import type { AppState, ChatAttachment, ChatMessage, LlmConfig, MediaModelType, SceneType, Session } from '../types';
import Avatar from './Avatar';
import { MULTIMEDIA_MODELS, routeModel } from '../engine/providers';
import { generateImage, generateVideo, matchMediaModel, type MediaMatch } from '../engine/media';
import { useVoiceInput } from '../hooks/useVoiceInput';
import {
  SCENE_HINT,
  SCENE_LABEL,
  buildPersonaSystem,
  positionOf,
  runTurn,
  suggestParticipants,
  supervisorOf,
} from '../engine/director';
import { newMessage, newSession } from '../store/storage';
import { downloadSessionMarkdown } from '../engine/sessionExport';
import LlmSetupModal from './LlmSetupModal';
import {
  attachmentEmoji,
  type PendingChatAttachment,
  toMessageAttachments,
  attachmentTypeLabel,
  buildAttachmentContext,
  chatAttachmentStore,
  openAttachment,
} from '../engine/chatAttachments';
import { formatBytes } from '../engine/knowledge';

interface Props {
  state: AppState;
  onUpdateState: (patch: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void;
  onToast: (msg: string) => void;
  initialScene?: SceneType;
  initialSageId?: string;
}

const SCENES: SceneType[] = ['solo', 'p2p', 'p2g', 'g2g', 'report', 'inquiry', 'consult'];

/** 提示词暂存：按会话存 localStorage，每会话最多 10 条 */
const STASH_KEY = 'evo/draft-stash';
interface StashItem {
  id: string;
  text: string;
  ts: number;
}

function readStash(sessionId: string): StashItem[] {
  try {
    const all = JSON.parse(localStorage.getItem(STASH_KEY) ?? '{}') as Record<string, StashItem[]>;
    return all[sessionId] ?? [];
  } catch {
    return [];
  }
}

function writeStash(sessionId: string, items: StashItem[]) {
  try {
    const all = JSON.parse(localStorage.getItem(STASH_KEY) ?? '{}') as Record<string, StashItem[]>;
    all[sessionId] = items.slice(-10);
    localStorage.setItem(STASH_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export default function SessionRoom({ state, onUpdateState, onToast, initialScene, initialSageId }: Props) {
  const [scene, setScene] = useState<SceneType>(initialScene ?? 'solo');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [mediaBar, setMediaBar] = useState<{ type: MediaModelType; modelId: string } | null>(null);
  const [mediaBusy, setMediaBusy] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [showModelSetup, setShowModelSetup] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const voice = useVoiceInput({ onText: (t) => setDraft(t), onError: (msg) => setMicError(msg) });
  /** 正在修改的已发送提示词 */
  const [editing, setEditing] = useState<{
    id: string;
    originalAttachments: ChatAttachment[];
  } | null>(null);
  /** 当前会话的暂存提示词 */
  const [stash, setStash] = useState<StashItem[]>([]);
  /** 侧栏搜索关键词：匹配标题与消息内容 */
  const [query, setQuery] = useState('');
  /** 会话重命名（头部标题行内编辑） */
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');

  // 识别成功启动时清除错误卡片
  useEffect(() => {
    if (voice.listening) setMicError(null);
  }, [voice.listening]);
  /** 已加载（ACTIVE）插件：在所有对话场景中自动生效 */
  const loadedPlugins = useMemo(
    () => (state.plugins ?? []).filter((p) => p.status === 'ACTIVE'),
    [state.plugins],
  );
  const [showLoaded, setShowLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentProgress, setAttachmentProgress] = useState<
{ done: number; total: number; current: string } | null
  >(null);
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const pendingAttachmentsRef = useRef<PendingChatAttachment[]>([]);

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(() => {
    if (initialScene) setScene(initialScene);
  }, [initialScene]);

  const sessions = useMemo(
    () => state.sessions.filter((s) => s.scene === scene),
    [state.sessions, scene],
  );
  const visibleSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? sessions.filter(
          (s) =>
            s.title.toLowerCase().includes(q) ||
            s.messages.some((m) => m.content.toLowerCase().includes(q)),
        )
      : sessions;
    return [...filtered].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [sessions, query]);
  // 关键修复：active 只在当前场景的会话中查找。此前跨场景全局查找，
  // 切换场景标签后聊天面板仍停留在旧场景会话上，导致「多人对话只有一人回答」
  const active = sessions.find((s) => s.id === state.activeSessionId) ?? sessions[0];

  /** 当前路由到的真实模型（含 providerKeys 免费额度路由） */
  const routedModel = useMemo(
    () => routeModel(state.llm, state.providerKeys ?? {}),
    [state.llm, state.providerKeys],
  );
  const hasModel = Boolean(routedModel);
  /** 先哲咨询默认联网检索；老会话未写入该字段时也按在线模式处理 */
  const isOnlineConsult = active?.scene === 'consult' && active.webMode !== 'offline';

  const setConsultWebMode = (webMode: 'online' | 'offline') => {
    if (!active || active.scene !== 'consult' || active.webMode === webMode) return;
    onUpdateState({
      sessions: state.sessions.map((s) => (s.id === active.id ? { ...s, webMode } : s)),
    });
  };

  // 切换场景时，把活动会话对齐到当前场景，避免误用其他场景的会话
  useEffect(() => {
    const list = state.sessions.filter((s) => s.scene === scene);
    if (!list.some((s) => s.id === state.activeSessionId)) {
      onUpdateState({ activeSessionId: list[0]?.id ?? null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  // 会话切换时：读取该会话的暂存提示词，退出编辑态
  useEffect(() => {
    setStash(active ? readStash(active.id) : []);
    setEditing(null);
    setDraft('');

    const staleIds = pendingAttachmentsRef.current
      .filter((item) => item.origin === 'new')
      .map((item) => item.id);
    pendingAttachmentsRef.current = [];
    setPendingAttachments([]);
    if (staleIds.length) {
      void chatAttachmentStore.removeMany(staleIds).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  /** 输入需求自动匹配多媒体模型（绘图/视频），匹配后用户仍可手动调整 */
  const mediaHint = useMemo(
    () => (draft.trim() ? matchMediaModel(draft, state) : null),
    [draft, state],
  );
  const effectiveMedia: MediaMatch | null = mediaBar
    ? (() => {
        const model = MULTIMEDIA_MODELS.find((m) => m.id === mediaBar.modelId);
        if (!model) return null;
        const match = matchMediaModel(draft || model.tags[0], state);
        return {
          type: model.type,
          model,
          auto: false,
          apiKey: match?.apiKey ?? (state.providerKeys ?? {})[model.providerId] ?? '',
          baseUrl: match?.baseUrl ?? '',
        };
      })()
    : mediaHint;

  const openMediaBar = (type: MediaModelType) => {
    const model = MULTIMEDIA_MODELS.find((m) => m.type === type && (state.providerKeys ?? {})[m.providerId]);
    if (model) setMediaBar({ type, modelId: model.id });
    else onToast(`尚未配置支持${type === 'image' ? '绘图' : '视频'}的模型 Key，请到「设置」填写`);
  };

  /** 执行多媒体生成并把结果写进会话 */
  const runMedia = async () => {
    if (!effectiveMedia || !active || mediaBusy) return;
    const prompt = draft.trim();
    if (!prompt) {
      onToast('请先输入创作需求描述');
      return;
    }
    setMediaBusy(effectiveMedia.type === 'image' ? '正在生成图片…' : '正在提交视频任务…');
    const result =
      effectiveMedia.type === 'image'
        ? await generateImage(effectiveMedia, prompt)
        : await generateVideo(effectiveMedia, prompt, (msg) => setMediaBusy(msg));
    setMediaBusy(null);

    const session = { ...active, messages: [...active.messages] };
    if (result.ok && result.url) {
      session.messages.push(
        effectiveMedia.type === 'image'
          ? { ...newMessage(session.id, 'media', effectiveMedia.model.name, result.url, 'agent'), kind: 'image' as const }
          : newMessage(session.id, 'media', effectiveMedia.model.name, `🎬 视频已生成：\n${result.url}`, 'agent'),
      );
      setMediaBar(null);
      setDraft('');
    } else {
      session.messages.push(newMessage(session.id, 'media', effectiveMedia.model.name, `❌ ${result.error ?? '生成失败'}`, 'system'));
    }
    onUpdateState({
      sessions: state.sessions.map((s) => (s.id === session.id ? session : s)),
      activeSessionId: session.id,
    });
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.messages.length, busy]);

  const openOrCreate = (target: Session) => {
    if (!state.sessions.some((s) => s.id === target.id)) {
      onUpdateState({ sessions: [...state.sessions, target], activeSessionId: target.id });
    } else {
      onUpdateState({ activeSessionId: target.id });
    }
  };

  const createSession = () => {
    if (!picked.length && scene !== 'consult') {
      onToast('请先选择参与的角色');
      return;
    }
    // 多人场景至少 2 位参与者，避免“多人对话只有一人”
    if ((scene === 'p2g' || scene === 'g2g') && picked.length < 2) {
      onToast('多人场景请至少选择 2 位参与者');
      return;
    }
    const suggested =
      scene === 'consult' ? [] : suggestParticipants(state, scene, picked[0]);
    const ids = Array.from(new Set([...picked, ...suggested]));
    const session = newSession({
      title: `${SCENE_LABEL[scene]} · ${ids
        .slice(0, 2)
        .map((id) => state.personas.find((p) => p.id === id)?.name ?? state.sages.find((s) => s.id === id)?.name ?? '')
        .join(' × ')}${ids.length > 2 ? ` 等 ${ids.length} 人` : ''}`,
      scene,
      participantIds: ids,
      teams:
        scene === 'g2g'
          ? [
              { id: 'team-a', name: 'A 组', side: 'A' as const, memberIds: ids.slice(0, Math.ceil(ids.length / 2)) },
              { id: 'team-b', name: 'B 组', side: 'B' as const, memberIds: ids.slice(Math.ceil(ids.length / 2)) },
            ]
          : [],
    });
    setShowPicker(false);
    setPicked([]);
    openOrCreate(session);
  };

  const startConsult = (sageId: string) => {
    const sage = state.sages.find((s) => s.id === sageId);
    if (!sage) return;
    const session = newSession({
      title: `问策 · ${sage.name}`,
      scene: 'consult',
      participantIds: [sage.id],
      webMode: 'online',
    });
    openOrCreate(session);
  };

  const consulted = useRef<string | null>(null);
  useEffect(() => {
    if (initialSageId && consulted.current !== initialSageId) {
      consulted.current = initialSageId;
      startConsult(initialSageId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSageId]);

  /** 重命名当前会话 */
  const startRename = () => {
    if (!active) return;
    setRenameDraft(active.title);
    setRenaming(true);
  };

  const saveRename = () => {
    const title = renameDraft.trim();
    if (active && title && title !== active.title) {
      onUpdateState({
        sessions: state.sessions.map((s) =>
          s.id === active.id ? { ...s, title, updatedAt: Date.now() } : s,
        ),
      });
    }
    setRenaming(false);
  };
  /** 复制任意消息内容 */
  const copyMessage = (text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => onToast('已复制到剪贴板'))
      .catch(() => onToast('复制失败，请手动选择文本复制'));
  };

  /** 修改已发送的提示词：载入输入框，发送后原消息原地更新 */
  const startEditMessage = (m: ChatMessage) => {
    const originalAttachments = m.attachments ?? [];
    setDraft(m.content);
    setPendingAttachments(
      originalAttachments.map((item) => ({ ...item, origin: 'existing' as const })),
    );
    setEditing({ id: m.id, originalAttachments });
  };

  const cancelEditing = () => {
    if (!editing) return;
    const staleIds = pendingAttachments
      .filter((item) => item.origin === 'new')
      .map((item) => item.id);
    setPendingAttachments(editing.originalAttachments.map((item) => ({ ...item, origin: 'existing' as const })));
    setEditing(null);
    setDraft('');
    if (staleIds.length) void chatAttachmentStore.removeMany(staleIds).catch(() => undefined);
  };

  const deleteMessage = async (id: string) => {
    if (!active || !window.confirm('\u5220\u9664\u8fd9\u6761\u63d0\u793a\u8bcd\uff1f\u5220\u9664\u540e\u4e0d\u53ef\u6062\u590d\u3002')) return;
    const target = active.messages.find((m) => m.id === id);
    onUpdateState({
      sessions: state.sessions.map((s) =>
        s.id === active.id ? { ...s, messages: s.messages.filter((m) => m.id !== id) } : s,
      ),
    });
    if (target?.attachments?.length) {
      try {
        await chatAttachmentStore.removeMany(target.attachments.map((item) => item.id));
      } catch {
        onToast('\u6d88\u606f\u5df2\u5220\u9664\uff0c\u4f46\u90e8\u5206\u9644\u4ef6\u7f13\u5b58\u6e05\u7406\u5931\u8d25');
      }
    }
    if (editing?.id === id) {
      setEditing(null);
      setDraft('');
      setPendingAttachments([]);
    }
    onToast('\u5df2\u5220\u9664\u8be5\u63d0\u793a\u8bcd');
  };

  const stashDraft = () => {
    const text = draft.trim();
    if (!text || !active) return;
    const items = [...stash, { id: `d-${Date.now().toString(36)}`, text, ts: Date.now() }].slice(-10);
    writeStash(active.id, items);
    setStash(items);
    setDraft('');
    onToast('提示词已暂停暂存，点击暂存条可恢复编辑');
  };

  /** 从暂存恢复到输入框继续编辑 */
  const restoreStashItem = (item: StashItem) => {
    setDraft(item.text);
    if (active) {
      const items = stash.filter((s) => s.id !== item.id);
      writeStash(active.id, items);
      setStash(items);
    }
  };

  /** 删除一条暂存 */
  const deleteStashItem = (id: string) => {
    if (!active) return;
    const items = stash.filter((s) => s.id !== id);
    writeStash(active.id, items);
    setStash(items);
  };

  const addAttachmentFiles = async (fileList: FileList | File[] | null) => {
    const files = Array.from(fileList ?? []);
    if (!files.length || attachmentBusy) return;
    setAttachmentBusy(true);
    try {
      const added: PendingChatAttachment[] = [];
      const failed: string[] = [];
      for (const [index, file] of files.entries()) {
        setAttachmentProgress({ done: index, total: files.length, current: file.name });
        try {
          const attachment = await chatAttachmentStore.put(file);
          added.push({ ...attachment, origin: 'new' as const });
          if (attachment.storage === 'memory') {
            failed.push(`${file.name}：浏览器持久存储不可用，已临时保存，刷新后会丢失`);
          }
        } catch (error) {
          const reason = (error as Error)?.message || '保存失败';
          failed.push(`${file.name}：${reason}`);
        }
      }
      if (added.length) setPendingAttachments((prev) => [...prev, ...added]);
      if (failed.length) {
        setAttachmentErrors(failed);
        onToast(`附件保存提醒：${failed.join('、')}`);
      }
    } finally {
      setAttachmentProgress(null);
      setAttachmentBusy(false);
    }
  };

  const removePendingAttachment = async (id: string) => {
    const target = pendingAttachments.find((item) => item.id === id);
    setPendingAttachments((prev) => prev.filter((item) => item.id !== id));
    if (target?.origin !== 'new') return;
    try {
      await chatAttachmentStore.remove(id);
    } catch {
      onToast('\u9644\u4ef6\u79fb\u9664\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9');
    }
  };

  const clearPendingAttachments = async () => {
    const staleIds = pendingAttachments
      .filter((item) => item.origin === 'new')
      .map((item) => item.id);
    setPendingAttachments([]);
    if (staleIds.length) {
      try {
        await chatAttachmentStore.removeMany(staleIds);
      } catch {
        onToast('\u9644\u4ef6\u6e05\u7406\u5931\u8d25\uff0c\u53ef\u7a0d\u540e\u91cd\u8bd5');
      }
    }
  };

  const handleAttachmentDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingFiles(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) void addAttachmentFiles(files);
  };

  const submitMessage = async (
    text: string,
    overrides?: {
      llm?: LlmConfig;
      providerKeys?: Record<string, string>;
      attachments?: ChatAttachment[];
    },
  ) => {
    if (!active || busy) return;
    const runState =
      overrides?.llm || overrides?.providerKeys
        ? {
            ...state,
            llm: overrides.llm ?? state.llm,
            providerKeys: overrides.providerKeys ?? state.providerKeys,
          }
        : state;
    const attachments = overrides?.attachments ?? [];
    const session = { ...active, messages: [...active.messages] };
    const attachmentContext = await buildAttachmentContext(attachments);
    const promptText = [text, attachmentContext].filter(Boolean).join('\n\n');
    const userMsg = {
      ...newMessage(session.id, 'me', '\u6211', text || '\uff08\u4e0a\u4f20\u9644\u4ef6\uff09', 'user'),
      ...(attachments.length ? { attachments } : {}),
    };
    session.messages.push(userMsg);

    onUpdateState({
      sessions: runState.sessions.map((s) => (s.id === session.id ? session : s)),
      activeSessionId: session.id,
    });
    setDraft('');
    setBusy(true);
    try {
      await runTurn(runState, session, promptText || '\u8bf7\u9605\u8bfb\u5e76\u5206\u6790\u4e0a\u4f20\u7684\u9644\u4ef6\u3002');
      // 用函数式更新而不是闭包里的 runState.sessions：一轮生成常耗时数十秒，
      // 期间用户可能删掉或新建了别的会话，直接回写旧数组会把那些改动整批抹掉。
      onUpdateState((prev) => ({
        sessions: prev.sessions.map((s) => (s.id === session.id ? { ...session } : s)),
        activeSessionId: session.id,
      }));
    } catch (e) {
      console.error('[session] \u672c\u8f6e\u751f\u6210\u5f02\u5e38\uff1a', e);
      onToast(`\u672c\u8f6e\u751f\u6210\u5931\u8d25\uff1a${(e as Error)?.message ?? '\u8bf7\u91cd\u8bd5'}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteActiveSession = async () => {
    if (!active || !window.confirm('\u5220\u9664\u8fd9\u4e2a\u4f1a\u8bdd\u53ca\u5176\u5168\u90e8\u9644\u4ef6\uff1f\u5220\u9664\u540e\u4e0d\u53ef\u6062\u590d\u3002')) return;
    const attachmentIds = active.messages.flatMap((message) => (message.attachments ?? []).map((item) => item.id));
    const staleIds = pendingAttachments
      .filter((item) => item.origin === 'new')
      .map((item) => item.id);

    onUpdateState({
      sessions: state.sessions.filter((s) => s.id !== active.id),
      activeSessionId: null,
    });
    setEditing(null);
    setDraft('');
    setPendingAttachments([]);
    try {
      await chatAttachmentStore.removeMany([...attachmentIds, ...staleIds]);
    } catch {
      onToast('\u4f1a\u8bdd\u5df2\u5220\u9664\uff0c\u4f46\u90e8\u5206\u9644\u4ef6\u7f13\u5b58\u6e05\u7406\u5931\u8d25');
    }
  };

  const send = async () => {
    const text = draft.trim();
    if ((!text && !pendingAttachments.length) || !active || busy || attachmentBusy) return;
    if (voice.listening) voice.stop();

    if (editing) {
      const attachments = toMessageAttachments(pendingAttachments);
      const removedIds = editing.originalAttachments
        .filter((item) => !attachments.some((next) => next.id === item.id))
        .map((item) => item.id);
      onUpdateState({
        sessions: state.sessions.map((s) =>
          s.id === active.id
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === editing.id
                    ? {
                        ...m,
                        content: text,
                        ts: Date.now(),
                        attachments: attachments.length ? attachments : undefined,
                      }
                    : m,
                ),
              }
            : s,
        ),
      });
      setEditing(null);
      setDraft('');
      setPendingAttachments([]);
      if (removedIds.length) {
        await chatAttachmentStore.removeMany(removedIds).catch(() => undefined);
      }
      onToast('\u5df2\u4fdd\u5b58\u5bf9\u63d0\u793a\u8bcd\u7684\u4fee\u6539');
      return;
    }

    const outgoingText = text || '\u8bf7\u9605\u8bfb\u5e76\u5206\u6790\u4e0a\u4f20\u7684\u9644\u4ef6\u3002';

    const messageAttachments = toMessageAttachments(pendingAttachments);

    if (!hasModel) {
      const attachmentContext = await buildAttachmentContext(messageAttachments);
      setPendingPrompt([outgoingText, attachmentContext].filter(Boolean).join('\n\n'));
      setShowModelSetup(true);
      return;
    }

    setPendingAttachments([]);
    await submitMessage(outgoingText, { attachments: messageAttachments });
  };

  const handleModelConfigured = (llm: LlmConfig, providerKeys: Record<string, string>) => {
    setShowModelSetup(false);
    const text = pendingPrompt;
    const attachments = toMessageAttachments(pendingAttachments);
    setPendingPrompt(null);
    setPendingAttachments([]);
    if (text) void submitMessage(text, { llm, providerKeys, attachments });
  };

  const speakerInfo = (id: string) => {
    const persona = state.personas.find((p) => p.id === id);
    if (persona) {
      const pos = positionOf(state, persona);
      return {
        name: persona.name,
        url: persona.avatarUrl,
        emoji: pos?.avatarEmoji,
        accent: pos?.accent,
        sub: pos?.name,
      };
    }
    const sage = state.sages.find((s) => s.id === id);
    if (sage) return { name: sage.name, url: sage.avatarUrl, emoji: sage.emoji, accent: sage.accent, sub: sage.school };
    return { name: '我', emoji: '🙂', accent: '#5b7cfa', sub: '' };
  };

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
      <div className="panel flex flex-col overflow-hidden">
        <div className="border-b border-white/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">会话</h2>
            <button className="btn-primary px-2 py-1 text-xs" onClick={() => setShowPicker(true)}>
              + 新建
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {SCENES.map((s) => (
              <button
                key={s}
                onClick={() => setScene(s)}
                className={`rounded-md px-2 py-1 text-[11px] transition ${
                  s === scene ? 'bg-royal-500/25 text-royal-400 ring-1 ring-royal-500/40' : 'text-slate-400 hover:bg-white/5'
                }`}
              >
                {SCENE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="border-b border-white/5 px-3 pb-2 pt-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话与消息…"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-royal-500/50"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {visibleSessions.map((s) => (
            <div
              key={s.id}
              onClick={() => onUpdateState({ activeSessionId: s.id })}
              className={`group mb-1 flex w-full cursor-pointer items-center gap-1 rounded-lg px-2.5 py-2 text-left transition ${
                s.id === active?.id ? 'bg-white/10' : 'hover:bg-white/5'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-100">
                  {s.pinned && (
                    <span className="mr-1 text-amber-400" title="已置顶">📌</span>
                  )}
                  {s.title}
                </div>
                <div className="text-[11px] text-slate-500">
                  {s.messages.length} 条 · {new Date(s.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                </div>
              </div>
              <button
                title={s.pinned ? '取消置顶' : '置顶会话'}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateState({
                    sessions: state.sessions.map((x) => (x.id === s.id ? { ...x, pinned: !x.pinned } : x)),
                  });
                }}
                className={`shrink-0 rounded p-1 text-xs transition ${
                  s.pinned ? 'text-amber-400 opacity-100' : 'text-slate-500 opacity-0 group-hover:opacity-100'
                }`}
              >
                📌
              </button>
            </div>
          ))}
          {!visibleSessions.length && (
            <div className="p-4 text-center text-xs text-slate-500">
              {query.trim() ? '没有匹配的会话' : '该场景还没有会话'}
            </div>
          )}
        </div>
        <div className="border-t border-white/5 p-3 text-[11px] leading-relaxed text-slate-500">
          {SCENE_HINT[scene]}
        </div>
      </div>

      <div className="panel flex flex-col overflow-hidden">
        {active ? (
          <>
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <div className="min-w-0 flex-1 pr-3">
                {renaming ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={saveRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename();
                      if (e.key === 'Escape') setRenaming(false);
                    }}
                    className="w-full max-w-sm rounded-lg border border-royal-500/40 bg-white/5 px-2 py-1 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-royal-500/60"
                  />
                ) : (
                  <div className="flex items-center gap-1.5" onDoubleClick={() => startRename()}>
                    <div className="truncate text-sm font-semibold text-slate-100" title="双击或点 ✏️ 重命名">
                      {active.title}
                    </div>
                    <button
                      title="重命名会话"
                      onClick={() => startRename()}
                      className="shrink-0 rounded p-0.5 text-[11px] text-slate-500 transition hover:text-slate-300"
                    >
                      ✏️
                    </button>
                  </div>
                )}
                <div className="text-[11px] text-slate-500">
                  {SCENE_LABEL[active.scene]} · 参与者 {active.participantIds.length} 位 ·{' '}
                  {hasModel ? `真实模型 ${routedModel?.model.name ?? ''}` : '未配置模型'}
                  {loadedPlugins.length > 0 && (
                    <span className="text-jade-400"> · 🔌 已加载插件 {loadedPlugins.length} 个</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className="btn-ghost text-xs"
                  onClick={() => {
                    downloadSessionMarkdown(active, state);
                    onToast('已导出为 Markdown 文件');
                  }}
                >
                  导出
                </button>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => void deleteActiveSession()}
                >
                  删除会话
                </button>
              </div>
            </div>

            <div className="wx-chat flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
              {/* 未配置模型提示：发送问话时自动打开 API 设置 */}
              {!hasModel && (
                <div className="wx-notice !max-w-full border border-amber-500/30 bg-amber-500/10 !text-amber-200">
                  当前为<b>未配置模型</b>：发送问话时会自动打开 API 设置窗口。
                  保存 API 参数后会自动继续当前问话。
                </div>
              )}
              {active.messages.map((m, idx) => {
                const prev = active.messages[idx - 1];
                const showTime =
                  !prev || m.ts - prev.ts > 5 * 60 * 1000;
                const info = speakerInfo(m.speakerId);
                const mine = m.role === 'user';
                const isNotice = m.role === 'system' || m.kind === 'notice';

                if (isNotice) {
                  return (
                    <div key={m.id} className="bubble-enter space-y-2">
                      <div className="wx-time">
                        {new Date(m.ts).toLocaleString('zh-CN', { hour12: false })}
                      </div>
                      <div className="wx-notice">{m.content}</div>
                    </div>
                  );
                }

                const isMedia = m.speakerId === 'media';
                return (
                  <div key={m.id} className="bubble-enter space-y-2">
                    {showTime && (
                      <div className="wx-time">
                        {new Date(m.ts).toLocaleString('zh-CN', {
                          hour12: false,
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    )}
                    <div className={`wx-msg group flex items-start gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                      {mine ? (
                        <Avatar name="我" emoji="🙂" size={38} square accent="#0aad5b" />
                      ) : (
                        <Avatar
                          name={info.name}
                          url={info.url}
                          emoji={isMedia ? '🖼️' : info.emoji}
                          accent={info.accent}
                          size={38}
                          square
                        />
                      )}
                      <div className={`flex max-w-[76%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                        {!mine && (
                          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                            <span className="text-slate-400">{m.speakerName}</span>
                            {info.sub && <span>· {info.sub}</span>}
                            {m.side && m.side !== 'none' && <span>· {m.side} 组</span>}
                          </div>
                        )}
                        <div
                          className={`wx-bubble text-sm ${
                            mine ? 'wx-bubble-mine' : 'wx-bubble-other'
                          }`}
                        >
                          {m.kind === 'image' ? (
                            <img
                              src={m.content}
                              alt={m.speakerName}
                              className="max-h-72 max-w-full rounded-md"
                            />
                          ) : (
                            m.content
                          )}
                        </div>
                          {m.attachments?.length ? (
                            <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
                              {m.attachments.map((a) => (
                                <button
                                  key={a.id}
                                  className="flex w-full min-w-0 items-center gap-2 rounded-md bg-black/10 px-2 py-1.5 text-left text-[11px] transition hover:bg-black/20"
                                  title={`\u6253\u5f00\u6216\u4e0b\u8f7d\uff1a${a.name}`}
                                  onClick={() => {
                                    void openAttachment(a).catch(() => onToast('\u9644\u4ef6\u5df2\u4e0d\u5b58\u5728\u6216\u8bfb\u53d6\u5931\u8d25'));
                                  }}
                                >
                                  <span aria-hidden="true">{attachmentEmoji(a)}</span>
                                  <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                                  <span className="shrink-0 text-slate-500">
                                    {attachmentTypeLabel(a)} {'\u00b7'} {formatBytes(a.size)}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        {/* 悬停操作：所有消息可复制；自己的提示词可修改/删除 */}
                        <div
                          className={`mt-0.5 flex items-center gap-2 opacity-0 transition group-hover:opacity-100 ${
                            mine ? 'flex-row-reverse' : ''
                          }`}
                        >
                          <button
                            className="text-[10px] text-slate-500 hover:text-royal-300"
                            title="复制内容"
                            onClick={() => copyMessage(m.content)}
                          >
                            📋 复制
                          </button>
                          {mine && m.kind !== 'image' && (
                            <>
                              <button
                                className="text-[10px] text-slate-500 hover:text-royal-300"
                                title="修改这条提示词（发送后原消息原地更新）"
                                onClick={() => startEditMessage(m)}
                              >
                                ✏️ 修改
                              </button>
                              <button
                                className="text-[10px] text-slate-500 hover:text-rose-300"
                                title="删除这条提示词"
                                onClick={() => deleteMessage(m.id)}
                              >
                                🗑 删除
                              </button>
                            </>
                          )}
                        </div>
                        {mine && (
                          <div className="mt-1 text-[10px] text-slate-500">
                            {new Date(m.ts).toLocaleTimeString('zh-CN', {
                              hour12: false,
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {busy && (
                <div className="wx-notice">
                  <span className="mr-1.5 inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-jade-400" />
                  对方正在输入…
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div
                className={`wx-inputbar relative ${isDraggingFiles ? 'ring-2 ring-royal-500/40' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDraggingFiles(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDraggingFiles(false);
                }}
                onDrop={handleAttachmentDrop}
              >
                {isDraggingFiles && (
                  <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border border-dashed border-royal-400/60 bg-ink-800/80 text-xs text-royal-200">
                    {'\u677e\u5f00\u9644\u4ef6\u5373\u53ef\u6dfb\u52a0'}
                  </div>
                )}
              {/* 已加载插件条：ACTIVE 插件在对话中自动生效，悬停查看能力 */}
              {loadedPlugins.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-white/5 bg-ink-700/40 px-2.5 py-1.5 text-[11px]">
                  <button
                    className="flex items-center gap-1 text-jade-400"
                    onClick={() => setShowLoaded((v) => !v)}
                    title="点击展开/收起详情"
                  >
                    🔌 已加载插件
                    <span className={`text-[9px] transition ${showLoaded ? 'rotate-180' : ''}`}>▾</span>
                  </button>
                  {loadedPlugins.slice(0, showLoaded ? loadedPlugins.length : 4).map((p) => (
                    <span
                      key={p.id}
                      className="rounded bg-jade-500/15 px-1.5 py-0.5 text-[10px] text-jade-300"
                      title={`${p.description}\n能力：${p.capabilities.join('、')}`}
                    >
                      {p.name}
                    </span>
                  ))}
                  {!showLoaded && loadedPlugins.length > 4 && (
                    <button className="text-[10px] text-slate-500 hover:text-slate-300" onClick={() => setShowLoaded(true)}>
                      +{loadedPlugins.length - 4}
                    </button>
                  )}
                  {showLoaded && (
                    <span className="text-[10px] text-slate-500">
                      发送消息时自动匹配能力并调用；「插件工具」页可管理
                    </span>
                  )}
                </div>
              )}
              {/* 语音输入诊断卡片：权限/环境问题常驻显示，直到解决 */}
              {micError && (
                <div className="mb-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[11px] leading-relaxed">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium text-rose-300">🎙️ 语音输入不可用</span>
                    <button
                      className="text-[10px] text-slate-400 hover:text-slate-200"
                      onClick={() => setMicError(null)}
                    >
                      知道了 ✕
                    </button>
                  </div>
                  <div className="text-slate-200">{micError}</div>
                  <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-slate-400">
                    <li>若当前在嵌入预览/小窗口中：复制本页地址，在独立浏览器标签页打开</li>
                    <li>点击浏览器地址栏左侧 🔒 或 🎙 图标 → 麦克风 → 改为「允许」</li>
                    <li>Windows 设置 → 隐私和安全性 → 麦克风 → 允许桌面应用访问</li>
                  </ol>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="rounded bg-royal-500 px-2.5 py-1 text-[11px] text-white hover:bg-royal-400"
                      onClick={() => {
                        navigator.clipboard
                          ?.writeText(window.location.href)
                          .then(() => onToast('本页地址已复制，可在独立标签页打开'))
                          .catch(() => onToast(`请手动复制：${window.location.href}`));
                      }}
                    >
                      复制本页地址
                    </button>
                    <button
                      className="rounded border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/10"
                      onClick={() => {
                        setMicError(null);
                        voice.toggle(draft);
                      }}
                    >
                      我已开启，重试
                    </button>
                  </div>
                </div>
              )}
              {/* 多媒体自动匹配条：输入「画…/生成视频…」自动出现，可手动换模型 */}
              {effectiveMedia && (
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-jade-500/25 bg-jade-500/5 px-2.5 py-2 text-[11px]">
                  <span className="text-jade-400">●</span>
                  <span className="text-slate-300">
                    {effectiveMedia.type === 'image' ? '🎨 绘图' : '🎬 视频'}
                    {effectiveMedia.auto ? '（自动匹配）' : '（手动指定）'}：
                  </span>
                  <select
                    className="rounded border border-white/10 bg-ink-700/70 px-1.5 py-1 text-[11px] text-slate-200"
                    value={effectiveMedia.model.id}
                    onChange={(e) => setMediaBar({ type: effectiveMedia.type, modelId: e.target.value })}
                  >
                    {MULTIMEDIA_MODELS.filter((m) => m.type === effectiveMedia.type).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="rounded bg-jade-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-jade-500 disabled:opacity-50"
                    onClick={() => void runMedia()}
                    disabled={Boolean(mediaBusy)}
                  >
                    {mediaBusy ?? '立即生成'}
                  </button>
                  <button
                    className="ml-auto text-[10px] text-slate-500 hover:text-slate-300"
                    onClick={() => setMediaBar(null)}
                  >
                    收起
                  </button>
                </div>
              )}
              {/* 修改提示词横幅 */}
              {editing && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                  {'\u270f\ufe0f \u6b63\u5728\u4fee\u6539\u5df2\u53d1\u9001\u7684\u63d0\u793a\u8bcd\uff0c\u53d1\u9001\u540e\u539f\u6d88\u606f\u539f\u5730\u66f4\u65b0\uff08\u4e0d\u4ea7\u751f\u65b0\u56de\u590d\uff09'}
                  <button
                    className="ml-auto text-[10px] text-slate-400 hover:text-slate-200"
                    onClick={cancelEditing}
                  >
                    {'\u53d6\u6d88\u4fee\u6539 \u2715'}
                  </button>
                </div>
              )}
              {stash.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-500/20 bg-ink-700/40 px-2.5 py-1.5 text-[11px]">
                  <span className="text-amber-400">⏸ 已暂停 {stash.length} 条</span>
                  {stash.map((item) => (
                    <span
                      key={item.id}
                      className="flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300"
                    >
                      <button
                        className="max-w-[200px] truncate hover:text-royal-300"
                        title={`${item.text}\n点击恢复到输入框继续编辑`}
                        onClick={() => restoreStashItem(item)}
                      >
                        {item.text}
                      </button>
                      <button
                        className="text-slate-500 hover:text-rose-300"
                        title="删除该暂存"
                        onClick={() => deleteStashItem(item.id)}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {attachmentProgress && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-royal-500/20 bg-royal-500/10 px-2.5 py-1.5 text-[11px] text-royal-200">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-royal-400" />
                  <span className="min-w-0 flex-1 truncate">
                    正在保存附件 {attachmentProgress.done + 1}/{attachmentProgress.total}：{attachmentProgress.current}
                  </span>
                </div>
              )}
              {attachmentErrors.length > 0 && (
                <div className="mb-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                  <div className="font-medium">附件保存提醒</div>
                  <ul className="mt-1 space-y-0.5">
                    {attachmentErrors.map((item) => (
                      <li key={item} className="break-all">{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {pendingAttachments.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-royal-500/25 bg-royal-500/10 px-2.5 py-2 text-[11px]">
                  {pendingAttachments.map((a) => (
                    <span
                      key={a.id}
                      className="flex max-w-full items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-slate-200"
                    >
                      <span aria-hidden="true">{attachmentEmoji(a)}</span>
                      <button
                        className="max-w-[220px] truncate hover:text-royal-300"
                        title={`${a.name}\n${attachmentTypeLabel(a)} \u00b7 ${formatBytes(a.size)}\n\u70b9\u51fb\u6253\u5f00\u6216\u4e0b\u8f7d`}
                        onClick={() => {
                          void openAttachment(a).catch(() => onToast('\u9644\u4ef6\u8bfb\u53d6\u5931\u8d25'));
                        }}
                      >
                        {a.name}
                      </button>
                      <button
                        className="text-slate-500 transition hover:text-rose-300"
                        title="移除附件"
                        onClick={() => void removePendingAttachment(a.id)}
                      >
                        {'\u2715'}
                      </button>
                    </span>
                  ))}
                  {attachmentBusy && <span className="text-slate-400">正在保存附件…</span>}
                  <button
                    className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-slate-500 transition hover:text-rose-300"
                    onClick={() => void clearPendingAttachments()}
                  >
                    {'\u6e05\u7a7a'}
                  </button>
                </div>
              )}
              {active.scene === 'consult' && (
                <div className="mb-2 flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
                  <span className="min-w-0 truncate text-[11px] text-slate-400">
                    {isOnlineConsult ? '联网回答：检索最新资料后综合' : '离线回答：依据既有学识作答'}
                  </span>
                  <div className="ml-2 flex shrink-0 rounded-md bg-black/20 p-0.5">
                    <button
                      className={`rounded px-2 py-1 text-[11px] transition ${
                        isOnlineConsult ? 'bg-royal-500/25 text-royal-300' : 'text-slate-400 hover:text-slate-200'
                      }`}
                      onClick={() => setConsultWebMode('online')}
                    >
                      联网
                    </button>
                    <button
                      className={`rounded px-2 py-1 text-[11px] transition ${
                        !isOnlineConsult ? 'bg-white/10 text-slate-200' : 'text-slate-400 hover:text-slate-200'
                      }`}
                      onClick={() => setConsultWebMode('offline')}
                    >
                      离线
                    </button>
                  </div>
                </div>
              )}
              <div className="mb-2 flex items-center gap-3 text-lg text-slate-400">
                <button title="生成图片（输入描述后点生成）" onClick={() => openMediaBar('image')}>
                  🎨
                </button>
                <button title="生成视频（输入描述后点生成）" onClick={() => openMediaBar('video')}>
                  🎬
                </button>
                                <input
                  ref={attachmentInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void addAttachmentFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
                <button
                  title="上传附件（不限文件类型，可多选）"
                  onClick={() => attachmentInputRef.current?.click()}
                  className="transition hover:text-royal-300"
                >
                  {'\u{1F4CE}'}
                </button>
                <button
                  title={voice.supported ? (voice.listening ? '停止语音输入' : '语音输入（中文识别）') : '当前浏览器不支持语音输入，请用 Chrome/Edge'}
                  onClick={() => voice.toggle(draft)}
                  className={`transition ${
                    voice.listening
                      ? 'rounded-full bg-rose-500/20 px-1.5 text-rose-400 ring-1 ring-rose-500/40'
                      : 'hover:text-royal-300'
                  }`}
                >
                  {voice.listening ? '⏹' : '🎙️'}
                </button>
                <button
                  title="暂停暂存当前提示词（稍后可从暂存条恢复编辑或删除）"
                  onClick={stashDraft}
                  className="transition hover:text-amber-300"
                >
                  ⏸
                </button>
                {voice.listening && (
                  <span className="flex items-center gap-1.5 text-[11px] text-rose-300">
                    <span className="h-1.5 w-1.5 animate-ping rounded-full bg-rose-400" />
                    正在聆听，请说话…（再点一次结束）
                  </span>
                )}
                <span className={`ml-auto text-[11px] ${hasModel ? 'text-slate-500' : 'text-amber-400'}`}>
                  {hasModel ? `真实模型 ${routedModel?.model.name ?? ''}` : '未配置模型'}
                </span>
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  className="input min-h-[52px] flex-1"
                  onPaste={(event) => {
                    const files = Array.from(event.clipboardData?.files ?? []);
                    if (files.length) {
                      event.preventDefault();
                      void addAttachmentFiles(files);
                    }
                  }}
                  placeholder={
                    active.scene === 'consult'
                      ? '说出你的困惑，先哲会按其思维框架回应…（也可点 🎙️ 语音输入）'
                      : '输入你的发言 / 议题，回车发送（Shift+Enter 换行，支持 🎙️ 语音输入）'
                  }
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  className="h-[52px] shrink-0 rounded-lg bg-[rgb(var(--jade-600))] px-6 text-sm font-medium text-white transition hover:bg-[rgb(var(--jade-500))] disabled:opacity-50"
                  onClick={send}
                  disabled={busy}
                >
                  发送(S)
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="text-sm text-slate-400">选择一个会话，或新建一个</div>
            <button className="btn-primary" onClick={() => setShowPicker(true)}>
              新建{SENE_LABEL_FALLBACK(scene)}
            </button>
          </div>
        )}
      </div>

      {showPicker && (
        <Picker
          state={state}
          scene={scene}
          picked={picked}
          onToggle={(id) =>
            setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
          }
          onCancel={() => {
            setShowPicker(false);
            setPicked([]);
          }}
          onConfirm={createSession}
          onPickSage={startConsult}
        />
      )}
      {showModelSetup && (
        <LlmSetupModal
          state={state}
          onUpdateState={onUpdateState}
          onClose={() => {
            setShowModelSetup(false);
            setPendingPrompt(null);
          }}
          onSaved={handleModelConfigured}
        />
      )}
    </div>
  );
}

function SENE_LABEL_FALLBACK(scene: SceneType) {
  return SCENE_LABEL[scene];
}

interface PickerProps {
  state: AppState;
  scene: SceneType;
  picked: string[];
  onToggle: (id: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onPickSage: (sageId: string) => void;
}

function Picker({ state, scene, picked, onToggle, onCancel, onConfirm, onPickSage }: PickerProps) {
  const [dept, setDept] = useState('全部');

  if (scene === 'consult') {
    return (
      <Modal title="选择一位先哲" onClose={onCancel}>
        <div className="grid max-h-[52vh] gap-2 overflow-y-auto md:grid-cols-2">
          {state.sages.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                onPickSage(s.id);
                onCancel();
              }}
              className="flex items-center gap-3 rounded-xl border border-white/5 bg-ink-700/50 p-3 text-left hover:bg-white/5"
            >
              <Avatar name={s.name} url={s.avatarUrl} emoji={s.emoji} accent={s.accent} size={40} />
              <div>
                <div className="text-sm text-slate-100">
                  {s.name}
                  <span className="ml-2 text-[11px] text-slate-500">{s.school}</span>
                </div>
                <div className="text-[11px] text-slate-500">{s.goodAt.join('、')}</div>
              </div>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  const departments = ['全部', ...Array.from(new Set(state.positions.map((p) => p.department)))];
  const list = state.personas.filter((p) => {
    if (!p.enabled) return false;
    const pos = positionOf(state, p);
    return dept === '全部' || pos?.department === dept;
  });

  const hint =
    scene === 'report'
      ? '建议先选下级，系统会自动带上其上级'
      : scene === 'inquiry'
        ? '建议先选上级，系统会自动带上其下级'
        : '可多选；第一个被选中的角色会成为场景的主角';

  return (
    <Modal title={`选择参与者 · ${SCENE_LABEL[scene]}`} onClose={onCancel}>
      <div className="mb-3 text-[11px] text-slate-500">{hint}</div>
      <div className="mb-3 flex flex-wrap gap-1">
        {departments.map((d) => (
          <button
            key={d}
            onClick={() => setDept(d)}
            className={`rounded-md px-2 py-1 text-[11px] ${
              d === dept ? 'bg-royal-500/25 text-royal-400' : 'text-slate-400 hover:bg-white/5'
            }`}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="grid max-h-[46vh] gap-2 overflow-y-auto md:grid-cols-2">
        {list.map((p) => {
          const pos = positionOf(state, p);
          const sup = supervisorOf(state, p);
          const checked = picked.includes(p.id);
          return (
            <button
              key={p.id}
              onClick={() => onToggle(p.id)}
              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                checked ? 'border-royal-500/50 bg-royal-500/15' : 'border-white/5 bg-ink-700/50 hover:bg-white/5'
              }`}
            >
              <Avatar name={p.name} url={p.avatarUrl} emoji={pos?.avatarEmoji} accent={pos?.accent} size={40} />
              <div className="min-w-0">
                <div className="truncate text-sm text-slate-100">{p.name}</div>
                <div className="truncate text-[11px] text-slate-500">
                  {pos?.name}
                  {sup ? ` · 向 ${sup.name} 汇报` : ''}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel}>
          取消
        </button>
        <button className="btn-primary" onClick={onConfirm}>
          创建会话
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="panel w-full max-w-2xl p-4 shadow-glow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <button className="text-slate-500 hover:text-slate-200" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export { buildPersonaSystem };
