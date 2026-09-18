/** 对话场景：本平台的核心抽象，决定"谁在什么规则下跟谁说话" */
export type SceneType =
  | 'solo' // 用户 ↔ 单个智能体
  | 'p2p' // 单人对单人（两个智能体对谈，用户任一方或旁观）
  | 'p2g' // 单人对多人（一人对一组）
  | 'g2g' // 多人对多人 / 小组对小组
  | 'report' // 下级向上级汇报
  | 'inquiry' // 上级向下级了解情况
  | 'consult'; // 先哲思想咨询

/** 头像来源：内置二次元 / 用户上传真人 / AI 生成 */
export type AvatarMode = 'anime' | 'real' | 'generated' | 'emoji';

/** 岗位（软件预置，可增删改） */
export interface Position {
  id: string;
  name: string;
  department: string;
  /** 岗位分类目录：高层管理 / 财务类 / 技术类 / 艺术设计类 等 */
  category: string;
  level: string;
  /** 汇报对象岗位 id，用于 report / inquiry 场景自动配对 */
  reportsTo?: string;
  duties: string[];
  skills: string[];
  kpis: string[];
  /** 沟通风格描述，会注入到该角色的系统提示词 */
  tone: string;
  /** 岗位默认头像关键词，用于 AI 生成二次元形象 */
  avatarPrompt: string;
  avatarEmoji: string;
  accent: string;
  builtin: boolean;
}

/** 人物（岗位实例化的具体数字员工） */
export interface Persona {
  id: string;
  positionId: string;
  name: string;
  avatarMode: AvatarMode;
  avatarUrl?: string;
  /** 二次元形象的风格标签，如 "细腻写实 / 柔和光" */
  avatarStyle?: string;
  /** 附加人格特征，覆盖岗位默认语气 */
  traits: string[];
  temperature: number;
  enabled: boolean;
}

/** 先哲人格卡：思想家 / 战略家 / 修行者，每人一套思维框架 */
export interface Sage {
  id: string;
  name: string;
  alias?: string;
  era: string;
  school: string;
  /** 核心思想，用于生成人格提示词 */
  coreIdeas: string[];
  /** 思维框架：遇到问题时按什么路径思考 */
  thinking: string[];
  speakingStyle: string;
  works: string[];
  quotes: string[];
  goodAt: string[];
  accent: string;
  emoji: string;
  builtin: boolean;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  speakerId: string;
  speakerName: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  ts: number;
  kind: 'text' | 'image' | 'notice';
  attachments?: ChatAttachment[];
  /** 小组对小组场景下标记所属阵营 */
  side?: 'A' | 'B' | 'none';
}

export interface Team {
  id: string;
  name: string;
  side: 'A' | 'B';
  memberIds: string[];
}

export interface Session {
  id: string;
  title: string;
  scene: SceneType;
  participantIds: string[];
  teams: Team[];
  messages: ChatMessage[];
  /** 发言顺序策略 */
  policy: TurnPolicy;
  createdAt: number;
  updatedAt: number;
  /** 置顶的会话在侧栏排最前 */
  pinned?: boolean;
}

export type TurnPolicy = 'round-robin' | 'moderated' | 'free';

/** AlphaSage 指标状态：缺数固定返回，不允许编造数值。 */
export type AlphaSageStatus = 'OK' | 'INSUFFICIENT_DATA';

/** AlphaSage 四大智能体域。 */
export type AlphaSageDomain = 'data' | 'analysis' | 'debate' | 'risk';

export interface AlphaSageMetric {
  id: string;
  name: string;
  layer: 'macro' | 'industry' | 'fundamental' | 'technical' | 'sentiment';
  status: AlphaSageStatus;
  /** 标准化信号：-1 看空，0 中性，1 看多。 */
  signal: number;
  value?: number;
  unit?: string;
  samples: number;
  reason?: string;
  formula: string;
  evidence?: string;
}

export interface AlphaSageAgentReport {
  agentId: string;
  agentName: string;
  roleName: string;
  domain: AlphaSageDomain;
  decision: 'PASS' | 'WARN' | 'BLOCK' | 'INSUFFICIENT_DATA';
  conclusion: string;
  evidence: string[];
  questions: string[];
}

export interface AlphaSageDecision {
  direction: '买入/加仓' | '持有/观望' | '回避/减仓' | '数据不足，暂不决策';
  positionSize: number;
  confidence: number;
  score: number;
  stopLoss?: number;
  maxDrawdown?: number;
  warnings: string[];
  reasonChain: string[];
  veto: boolean;
}

export interface AlphaSageAuditEvent {
  at: string;
  actor: string;
  action: string;
  detail: string;
}

export interface AlphaSageInput {
  target: string;
  horizon: '短线' | '中线' | '长线';
  riskProfile: 'aggressive' | 'balanced' | 'conservative';
  maxPosition: number;
  stopLoss: number | null;
  maxDrawdown: number | null;
  note: string;
  macro: string;
  industry: string;
  fundamental: string;
  ohlcv: string;
  sentiment: string;
}

export interface AlphaSageRun {
  id: string;
  target: string;
  horizon: '短线' | '中线' | '长线';
  riskProfile: 'aggressive' | 'balanced' | 'conservative';
  createdAt: string;
  updatedAt: string;
  status: 'OK' | 'INSUFFICIENT_DATA';
  input: AlphaSageInput;
  metrics: AlphaSageMetric[];
  reports: AlphaSageAgentReport[];
  decision: AlphaSageDecision;
  audit: AlphaSageAuditEvent[];
}

export interface LlmConfig {
  enabled: boolean;
  provider: 'local-mock' | 'openai-compatible';
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  /** 是否优先使用免费额度模型 */
  preferFree: boolean;
  /** 选定的 provider id，空则自动选择 */
  selectedProviderId?: string;
}

/** 多媒体生成模型（绘图 / 视频） */
export type MediaModelType = 'image' | 'video';

export interface MediaModelPreset {
  id: string;
  name: string;
  type: MediaModelType;
  /** 所属供应商（复用其 API Key 与 baseUrl） */
  providerId: string;
  isFree: boolean;
  /** 能力说明 */
  notes: string;
  tags: string[];
}

/** 多媒体模型设置：用户在设置中心一次性配置，前端输入需求时自动匹配 */
export interface MediaSettings {
  /** 手动锁定的绘图模型（不设置则自动匹配） */
  imageModelId?: string;
  /** 手动锁定的视频模型 */
  videoModelId?: string;
  /** 关闭自动匹配（完全手动） */
  manualOnly?: boolean;
}

/** 国内大模型供应商注册项 */
export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  /** 官网申请 API Key 的地址 */
  apiKeyUrl: string;
  models: ModelPreset[];
  builtin: boolean;
}

export interface ModelPreset {
  id: string;
  name: string;
  contextWindow: number;
  isFree: boolean;
  /** 免费额度（次/日），0 表示无免费 */
  freeQuotaDaily: number;
  inputPerMillion: number;
  outputPerMillion: number;
  /** 适合场景标签 */
  tags: string[];
}

/** 插件（工具）：智能体可调用的能力 */
export interface Plugin {
  id: string;
  name: string;
  version: number;
  status: 'DRAFT' | 'REVIEW_REQUIRED' | 'ACTIVE' | 'COOLING' | 'QUARANTINED';
  description: string;
  /** 插件代码（浏览器内 Function 执行） */
  code: string;
  /** 输入参数 JSON Schema 描述 */
  inputSchema: Record<string, string>;
  /** 能力标签，供能力图谱匹配 */
  capabilities: string[];
  permissions: string[];
  limits: { timeoutMs: number; maxOutputBytes: number };
  tests: { input: unknown; expected: unknown }[];
  lastTestResult?: {
    at: string;
    ok: boolean;
    output: string;
    durationMs: number;
    qualityPassed: boolean;
  };
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 智能体进化日志 */
export interface EvolutionLog {
  id: string;
  at: string;
  type:
    | 'PLAN_START'
    | 'STEP_START'
    | 'STEP_RESULT'
    | 'RECOVERY_REQUIRED'
    | 'QUALITY_GATE'
    | 'QUALITY_REPAIR_REQUIRED'
    | 'DELIVERY_BLOCKED'
    | 'TASK_COMPLETE'
    | 'REVIEW_SUGGESTION'
    | 'REVIEW_APPROVED'
    | 'REVIEW_REJECTED'
    | 'PLUGIN_EVOLVED'
    | 'CAPABILITY_GAP';
  message: string;
  pluginId?: string;
  runId?: string;
  details?: Record<string, unknown>;
}

/** 进化建议：OuterReviewer 对 InnerAgent 运行结果给出的改进项 */
export interface EvolutionSuggestion {
  id: string;
  kind: 'add' | 'modify' | 'delete' | 'quality_repair';
  pluginId?: string;
  reason: string;
  patch?: Partial<Plugin>;
  plugin?: Plugin;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

/** 记事本附件类型：二进制本体在 IndexedDB，这里只保存轻量元数据 */
export type NotepadMediaKind = 'image' | 'audio' | 'video';

export interface NotepadMediaMeta {
  id: string;
  kind: NotepadMediaKind;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  /** 用户可以逐个附件选择是否复制进知识库 */
  includeInKb: boolean;
}

export interface NotepadNote {
  id: string;
  title: string;
  content: string;
  media: NotepadMediaMeta[];
  createdAt: string;
  updatedAt: string;
  /** 是否把当前笔记内容/选中的附件复制到知识库 */
  includeInKb: boolean;
  /** 最近一次成功导出到知识库后标记；内容再变化时会回到未同步 */
  savedToKb: boolean;
  savedAt?: string;
}
export interface NotepadSettings {
  /** 单文件上传上限；null 表示无限制 */
  maxUploadBytes: number | null;
}
export interface AppState {
  positions: Position[];
  personas: Persona[];
  sages: Sage[];
  sessions: Session[];
  llm: LlmConfig;
  activeSessionId: string | null;
  /** 用户自定义 provider API Keys（provider id → key） */
  providerKeys: Record<string, string>;
  /** 插件注册表 */
  plugins: Plugin[];
  /** 进化日志 */
  evolutionLogs: EvolutionLog[];
  /** 待审批的进化建议 */
  evolutionSuggestions: EvolutionSuggestion[];
  /** AlphaSage 投资分析流水线留痕（只追加，不覆盖删除） */
  investmentRuns: AlphaSageRun[];
  /** 记事本：正文元数据；附件 Blob 单独保存到 IndexedDB */
  notes: NotepadNote[];
  /** 记事本设置 */
  notepad: NotepadSettings;
  /** 多媒体模型设置（绘图 / 视频） */
  media: MediaSettings;
}
