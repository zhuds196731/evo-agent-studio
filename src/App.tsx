import { useCallback, useEffect, useRef, useState } from 'react';
import { publicAsset } from './utils/assets';
import type { AppState, Persona, SceneType } from './types';
import { loadState, saveState } from './store/storage';
import PositionCenter from './components/PositionCenter';
import SessionRoom from './components/SessionRoom';
import SageHall from './components/SageHall';
import SettingsPanel from './components/SettingsPanel';
import UsagePanel from './components/UsagePanel';
import PluginPanel from './components/PluginPanel';
import EvolutionPanel from './components/EvolutionPanel';
import HelpPanel from './components/HelpPanel';
import AboutPanel from './components/AboutPanel';
import KnowledgePanel from './components/KnowledgePanel';
import NotepadPanel from './components/NotepadPanel';
import InvestmentPanel from './components/InvestmentPanel';
import ThemeSwitcher, { applyTheme, currentTheme } from './components/ThemeSwitcher';
import HealthClock from './components/HealthClock';
import PcAssistant from './components/PcAssistant';
import TvAgent from './components/TvAgent';
import ToolLauncher from './components/ToolLauncher';
import GfSecurities from './components/GfSecurities';
import ImaPanel from './components/ImaPanel';

type View =
  | 'positions'
  | 'sessions'
  | 'investment'
  | 'gf'
  | 'ima'
  | 'sages'
  | 'knowledge'
  | 'notepad'
  | 'usage'
  | 'settings'
  | 'plugins'
  | 'evolution'
  | 'help'
  | 'about'
  | 'pc'
  | 'tv';

const NAV: { key: View; label: string; icon: string }[] = [
  { key: 'positions', label: '岗位中心', icon: '🏢' },
  { key: 'sessions', label: '协同会话', icon: '💬' },
  { key: 'investment', label: '投资分析', icon: '📈' },
  { key: 'gf', label: '广发投研', icon: '🏦' },
  { key: 'ima', label: 'IMA 知识库', icon: '🧠' },
  { key: 'sages', label: '先哲堂', icon: '🪷' },
  { key: 'knowledge', label: '知识库', icon: '📚' },
  { key: 'notepad', label: '记事本', icon: '📝' },
  { key: 'plugins', label: '插件工具', icon: '🔌' },
  { key: 'evolution', label: '自进化', icon: '🧬' },
  { key: 'usage', label: '用量看板', icon: '🧮' },
  { key: 'settings', label: '设置', icon: '⚙️' },
  { key: 'help', label: '帮助', icon: '❓' },
  { key: 'about', label: '关于', icon: 'ℹ️' },
];

const VIEW_KEYS: View[] = [
  'positions', 'sessions', 'investment', 'gf', 'ima', 'sages', 'knowledge', 'notepad',
  'usage', 'settings', 'plugins', 'evolution', 'help', 'about', 'pc', 'tv',
];

/** 支持 #pc / #tv 这样的深链，方便直达某个面板 */
function initialView(): View {
  const hash = window.location.hash.replace('#', '') as View;
  return VIEW_KEYS.includes(hash) ? hash : 'sessions';
}

export default function App() {
  const [state, setState] = useState<AppState>(loadState);
  // 启动时应用持久化的皮肤
  useEffect(() => {
    applyTheme(currentTheme());
  }, []);
  const [view, setView] = useState<View>(initialView);

  // 视图变化同步到地址栏 hash，刷新/收藏都能回到同一页面
  useEffect(() => {
    if (window.location.hash !== `#${view}`) {
      window.history.replaceState(null, '', `#${view}`);
    }
  }, [view]);
  const [toast, setToast] = useState<string | null>(null);
  const [consult, setConsult] = useState<{ sageId: string; scene: SceneType } | null>(null);
  const handledConsult = useRef<string | null>(null);

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const update = useCallback((patch: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => {
    setState((prev) =>
      typeof patch === 'function' ? { ...prev, ...patch(prev) } : { ...prev, ...patch },
    );
  }, []);

  const createPersona = useCallback((persona: Persona) => {
    setState((prev) => ({ ...prev, personas: [...prev.personas, persona] }));
  }, []);

  const onConsult = (sageId: string) => {
    if (handledConsult.current === `consult:${sageId}`) {
      setView('sessions');
      return;
    }
    handledConsult.current = `consult:${sageId}`;
    setConsult({ sageId, scene: 'consult' });
    setView('sessions');
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <img
            src={publicAsset('icon-512.png')}
            alt="Self-Evolving Agent"
            className="h-9 w-9 select-none drop-shadow-[0_0_6px_rgb(var(--royal-500)/0.35)]"
          />
          <div>
            <div className="text-sm font-semibold tracking-wide text-slate-100">
              Self‑Evolving Agent
            </div>
            <div className="text-[11px] text-slate-500">多模态智能体协同 · 岗位数字人 · 先哲思想咨询</div>
          </div>
        </div>
        <HealthClock state={state} onUpdateState={update} />
        <nav className="flex flex-wrap items-center justify-end gap-1">
          <ToolLauncher activeKey={view} onPick={(key) => setView(key as View)} />
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => setView(n.key)}
              className={`rounded-lg px-3 py-1.5 text-xs transition ${
                view === n.key
                  ? 'bg-white/10 text-slate-100 ring-1 ring-white/10'
                  : 'text-slate-400 hover:bg-white/5'
              }`}
            >
              <span className="mr-1">{n.icon}</span>
              {n.label}
            </button>
          ))}
          <ThemeSwitcher />
        </nav>
      </header>

      <main className="min-h-0 flex-1 p-4">
        {view === 'positions' && (
          <PositionCenter
            state={state}
            onUpdateState={update}
            onCreatePersona={createPersona}
            onToast={setToast}
          />
        )}
        {view === 'sessions' && (
          <SessionRoom
            key={consult?.sageId ?? 'default'}
            state={state}
            onUpdateState={update}
            onToast={setToast}
            initialScene={consult?.scene}
            initialSageId={consult?.sageId}
          />
        )}
        {view === 'investment' && <InvestmentPanel state={state} onUpdateState={update} onToast={setToast} />}
        {view === 'gf' && <GfSecurities onToast={setToast} />}
        {view === 'ima' && <ImaPanel onToast={setToast} />}
        {view === 'sages' && (
          <SageHall state={state} onUpdateState={update} onConsult={onConsult} onToast={setToast} />
        )}
        {view === 'knowledge' && <KnowledgePanel state={state} onToast={setToast} />}
        {view === 'notepad' && (
          <NotepadPanel
            state={state}
            onUpdateState={update}
            onToast={setToast}
          />
        )}
        {view === 'plugins' && (
          <PluginPanel state={state} onUpdateState={update} onToast={setToast} />
        )}
        {view === 'evolution' && (
          <EvolutionPanel state={state} onUpdateState={update} onToast={setToast} />
        )}
        {view === 'usage' && <UsagePanel onToast={setToast} />}
        {view === 'settings' && (
          <SettingsPanel
            state={state}
            onUpdateState={update}
            onReplaceState={setState}
            onToast={setToast}
          />
        )}
        {view === 'help' && <HelpPanel />}
        {view === 'about' && <AboutPanel state={state} />}
        {view === 'pc' && <PcAssistant state={state} onToast={setToast} />}
        {view === 'tv' && <TvAgent onToast={setToast} />}
      </main>

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 bg-ink-700/95 px-4 py-2 text-xs text-slate-100 shadow-glow">
          {toast}
        </div>
      )}
    </div>
  );
}
