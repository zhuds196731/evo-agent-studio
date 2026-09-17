import { useMemo, useState } from 'react';
import type { AlphaSageRun, AppState, LlmConfig } from '../types';
import { generate } from '../engine/llm';
import { routeModel } from '../engine/providers';
import LlmSetupModal from './LlmSetupModal';
import {
  buildInvestmentAiSystem,
  INVESTMENT_AI_FOCUS_LABEL,
  INVESTMENT_AI_MODE_LABEL,
  type InvestmentAiFocus,
  type InvestmentAiMode,
} from '../engine/investmentPrompts';

interface Props {
  run: AlphaSageRun | null;
  state: AppState;
  onUpdateState: (patch: Partial<AppState>) => void;
  variant?: 'full' | 'compact';
  onToast?: (message: string) => void;
}

interface AskTurn {
  role: 'user' | 'assistant';
  content: string;
  source?: 'model' | 'budget';
}

const MODES: InvestmentAiMode[] = ['strict-no-judgment', 'strict-judgment', 'exploratory'];
const FOCUSES: InvestmentAiFocus[] = [
  'comprehensive',
  'macro',
  'industry',
  'fundamental',
  'technical',
  'sentiment',
  'risk',
  'bias',
];

const QUESTION_TEMPLATES: { id: string; label: string; text: string }[] = [
  {
    id: 'review',
    label: '交易复盘',
    text: '请基于当前证据包做一次交易复盘，重点说明数据缺口、风控约束、已验证信号和下一步条件。',
  },
  {
    id: 'debate',
    label: '多空辩论',
    text: '请分别整理当前证据包中的买入逻辑和风险逻辑，指出哪一侧证据更扎实，并给出需要验证的条件。',
  },
  {
    id: 'scenario',
    label: '情景推演',
    text: '请按上涨、震荡、下跌三种情景推演当前证据，说明每种情景的触发条件和观察指标。',
  },
  {
    id: 'gaps',
    label: '数据审计',
    text: '请审计当前证据包的完整性和时效性，列出缺失数据、异常数据和不能据此判断的结论。',
  },
];

export default function InvestmentAiPanel({
  run,
  state,
  onUpdateState,
  variant = 'full',
  onToast,
}: Props) {
  const [mode, setMode] = useState<InvestmentAiMode>('strict-no-judgment');
  const [focus, setFocus] = useState<InvestmentAiFocus>('comprehensive');
  const [question, setQuestion] = useState(QUESTION_TEMPLATES[0].text);
  const [history, setHistory] = useState<AskTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModelSetup, setShowModelSetup] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  const system = useMemo(() => buildInvestmentAiSystem(run, mode, focus), [run, mode, focus]);
  const providerKeys = state.providerKeys ?? {};
  const hasModel = Boolean(routeModel(state.llm, providerKeys));
  const lastAnswer = useMemo(
    () => [...history].reverse().find((item) => item.role === 'assistant') ?? null,
    [history],
  );

  const send = async (
    promptOverride?: string,
    modelOverride?: { llm: LlmConfig; providerKeys: Record<string, string> },
  ) => {
    const prompt = (promptOverride ?? question).trim();
    if (!prompt || busy) return;
    if (!hasModel && !modelOverride) {
      setPendingPrompt(prompt);
      setShowModelSetup(true);
      return;
    }

    const nextHistory: AskTurn[] = [...history, { role: 'user', content: prompt }];
    setHistory(nextHistory);
    setQuestion('');
    setBusy(true);
    setError(null);

    try {
      const result = await generate(
        {
          system,
          history: nextHistory.map((item) => ({ role: item.role, content: item.content })),
          prompt,
          temperature: mode === 'strict-no-judgment' ? 0.15 : mode === 'strict-judgment' ? 0.25 : 0.55,
          maxTokens: 1400,
          sessionId: `investment-ai-${run?.id ?? 'draft'}`,
          speakerId: 'investment-ai',
          speakerName: 'AlphaSage 问话',
          scene: 'investment-ai',
          providerKeys: modelOverride?.providerKeys ?? providerKeys,
        },
        modelOverride?.llm ?? state.llm,
      );
      setHistory([
        ...nextHistory,
        { role: 'assistant', content: result.text, source: result.source },
      ]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleModelConfigured = (llm: LlmConfig, nextProviderKeys: Record<string, string>) => {
    setShowModelSetup(false);
    const prompt = pendingPrompt;
    setPendingPrompt(null);
    if (prompt) {
      setQuestion('');
      void send(prompt, { llm, providerKeys: nextProviderKeys });
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(system);
      onToast?.('AI 问话提示词已复制');
    } catch {
      onToast?.('复制失败，请在提示词预览中手动复制');
    }
  };

  const evidenceBadge = run
    ? `${run.target} · ${run.status === 'OK' ? '五层报告已生成' : '数据不足报告'}`
    : '未生成报告 · 只允许询问数据缺口';
  const evidenceTone = run
    ? run.status === 'OK'
      ? 'text-jade-300'
      : 'text-amber-300'
    : 'text-amber-300';

  const controls = variant === 'full' ? (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-1">
        {MODES.map((item) => (
          <button
            key={item}
            onClick={() => setMode(item)}
            className={`rounded-lg px-2.5 py-1.5 text-[11px] transition ${
              mode === item
                ? 'bg-white/10 text-slate-100 ring-1 ring-white/10'
                : 'text-slate-400 hover:bg-white/5'
            }`}
          >
            {INVESTMENT_AI_MODE_LABEL[item]}
          </button>
        ))}
      </div>
      <span className="text-[10px] text-slate-500">隔离上下文 · 仅解释证据包</span>
    </div>
  ) : (
    <div className="grid grid-cols-2 gap-2">
      <select
        className="input text-[11px]"
        value={mode}
        onChange={(event) => setMode(event.target.value as InvestmentAiMode)}
        title="选择提示词模式"
      >
        {MODES.map((item) => (
          <option key={item} value={item}>{INVESTMENT_AI_MODE_LABEL[item]}</option>
        ))}
      </select>
      <select
        className="input text-[11px]"
        value={focus}
        onChange={(event) => setFocus(event.target.value as InvestmentAiFocus)}
        title="选择分析视角"
      >
        {FOCUSES.map((item) => (
          <option key={item} value={item}>{INVESTMENT_AI_FOCUS_LABEL[item]}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className={variant === 'full' ? 'grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3' : 'space-y-3'}>
      <section className="rounded-xl border border-white/5 bg-ink-700/35 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {variant === 'compact' && <h4 className="text-xs font-semibold text-slate-200">AI 问话</h4>}
          <span className={`rounded-md bg-white/5 px-2 py-1 text-[10px] ${evidenceTone}`}>{evidenceBadge}</span>
        </div>

        <div className="mt-3">{controls}</div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className={`input text-[11px] ${variant === 'full' ? 'w-[150px]' : 'flex-1'}`}
            value={QUESTION_TEMPLATES.find((item) => item.text === question)?.id ?? ''}
            onChange={(event) => {
              const template = QUESTION_TEMPLATES.find((item) => item.id === event.target.value);
              if (template) {
                if (!hasModel) {
                  setPendingPrompt(template.text);
                  setShowModelSetup(true);
                  return;
                }
                setQuestion(template.text);
              }
            }}
          >
            <option value="">选择问题模板</option>
            {QUESTION_TEMPLATES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <button className="btn-ghost text-[11px]" onClick={() => void copyPrompt()}>
            复制提示词
          </button>
        </div>

        <details className="mt-2 rounded-lg border border-white/5 bg-ink-800/45 p-2">
          <summary className="cursor-pointer text-[11px] text-slate-400">查看当前 AI 问话提示词</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-4 text-slate-500">
            {system}
          </pre>
        </details>
      </section>

      {variant === 'full' && (
        <section className="min-h-0 overflow-y-auto rounded-xl border border-white/5 bg-ink-800/35 p-3">
          {!history.length && (
            <div className="text-xs leading-5 text-slate-500">
              AI 会按证据包回答，回复结构固定为数据审计、客观事实、数据分析、判断或条件建议、风险、结论。
            </div>
          )}
          <div className="space-y-3">
            {history.map((item, index) => (
              <div
                key={index}
                className={`rounded-xl border px-3 py-2 text-xs leading-5 ${
                  item.role === 'user'
                    ? 'border-white/10 bg-white/5 text-slate-200'
                    : 'border-royal-500/20 bg-royal-500/10 text-slate-300'
                }`}
              >
                <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
                  <span>{item.role === 'user' ? '你' : 'AlphaSage 问话'}</span>
                  {item.source && (
                    <span>
                      {item.source === 'model' ? '模型' : '预算拦截'}
                    </span>
                  )}
                </div>
                <pre className="whitespace-pre-wrap font-sans">{item.content}</pre>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="shrink-0 rounded-xl border border-white/5 bg-ink-800/35 p-3">
        {error && <div className="mb-2 text-[11px] text-rose-300">{error}</div>}
        {variant === 'compact' && lastAnswer && (
          <div className="mb-2 max-h-[132px] overflow-y-auto rounded-lg border border-royal-500/20 bg-royal-500/10 p-2">
            <div className="mb-1 text-[10px] text-slate-500">最近回答</div>
            <pre className="whitespace-pre-wrap font-sans text-[11px] leading-5 text-slate-300">{lastAnswer.content}</pre>
          </div>
        )}
        <textarea
          className="input min-h-[64px] resize-y text-xs"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="问复盘、风险、条件触发或情景推演"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-500">
            {INVESTMENT_AI_MODE_LABEL[mode]} · {INVESTMENT_AI_FOCUS_LABEL[focus]}
          </span>
          <div className="flex gap-2">
            <button
              className="btn-ghost text-xs"
              onClick={() => {
                setHistory([]);
                setError(null);
              }}
              disabled={busy || !history.length}
            >
              清空
            </button>
            <button
              className="btn-royal text-xs"
              onClick={() => void send()}
              disabled={busy || !question.trim()}
            >
              {busy ? '思考中' : '发送'}
            </button>
          </div>
        </div>
      </section>
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
