/**
 * 分层记忆：对应旧工程 hierarchical-memory-store.js，前端 localStorage 实现。
 * 7 scope × 6 type，召回按 词匹配×confidence(衰减)×recency×scopeWeight 排序，
 * 自动 forget 过期与低置信记忆，作为上下文编排的检索基础以省 token。
 */

const STORE_KEY = 'evo/memories';

export const SCOPES = ['USER', 'SESSION', 'TASK', 'PROJECT', 'ROLE', 'DEPARTMENT', 'COMPANY'] as const;
export const TYPES = ['FACT', 'DECISION', 'PREFERENCE', 'EVIDENCE', 'SUMMARY', 'PROCEDURE'] as const;
export type ScopeType = (typeof SCOPES)[number];
export type MemoryType = (typeof TYPES)[number];

const SCOPE_WEIGHT: Record<ScopeType, number> = {
  TASK: 1,
  SESSION: 0.95,
  PROJECT: 0.9,
  ROLE: 0.85,
  USER: 0.82,
  DEPARTMENT: 0.75,
  COMPANY: 0.7,
};

export interface Memory {
  id: string;
  key: string;
  content: string;
  scopeType: ScopeType;
  scopeId: string;
  type: MemoryType;
  ownerId: string | null;
  visibility: 'PRIVATE' | 'PUBLIC';
  tags: string[];
  confidence: number;
  decayRate: number;
  status: 'ACTIVE' | 'EXPIRED' | 'FORGOTTEN' | 'SUPERSEDED';
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  accessCount: number;
}

export interface Principal {
  userId?: string;
  sessionId?: string;
  taskId?: string;
  projectId?: string;
  roleId?: string;
  departmentId?: string;
  companyId?: string;
}

export interface RecallResult {
  memory: Memory;
  score: number;
  confidence: number;
}

function read(): Memory[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as Memory[];
  } catch {
    return [];
  }
}

function write(rows: Memory[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(rows.slice(-10000)));
  } catch {
    /* ignore */
  }
}

function tokenize(value: string): string[] {
  const matched = String(value || '').toLowerCase().match(/[\p{L}\p{N}_-]+/gu);
  return [...new Set(matched ?? [])];
}

function defaultVisibility(scope: ScopeType): 'PRIVATE' | 'PUBLIC' {
  return scope === 'USER' || scope === 'SESSION' ? 'PRIVATE' : 'PUBLIC';
}

function allowed(memory: Memory, principal: Principal): boolean {
  if (memory.visibility === 'PRIVATE') {
    return Boolean(memory.ownerId && memory.ownerId === principal.userId);
  }
  const map: Partial<Record<ScopeType, string | undefined>> = {
    USER: principal.userId,
    SESSION: principal.sessionId,
    TASK: principal.taskId,
    PROJECT: principal.projectId,
    ROLE: principal.roleId,
    DEPARTMENT: principal.departmentId,
    COMPANY: principal.companyId,
  };
  if (memory.scopeType === 'COMPANY') return true;
  return map[memory.scopeType] === memory.scopeId;
}

function effectiveConfidence(memory: Memory, now = Date.now()): number {
  const reliability = 1;
  if (['DECISION', 'EVIDENCE', 'PROCEDURE'].includes(memory.type)) {
    return memory.confidence * reliability;
  }
  const ageDays = Math.max(0, (now - Date.parse(memory.updatedAt)) / 86400000);
  return memory.confidence * Math.exp(-memory.decayRate * ageDays) * reliability;
}

export const memoryStore = {
  put(input: {
    content: string;
    scopeType?: ScopeType;
    scopeId: string;
    type?: MemoryType;
    key?: string;
    tags?: string[];
    confidence?: number;
    decayRate?: number;
    expiresAt?: string | null;
    ownerId?: string | null;
  }): Memory {
    const scopeType = input.scopeType ?? 'TASK';
    const type = input.type ?? 'FACT';
    const now = new Date().toISOString();
    const memory: Memory = {
      id: `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      key: input.key ?? String(input.content).slice(0, 16),
      content: String(input.content).trim(),
      scopeType,
      scopeId: input.scopeId,
      type,
      ownerId: input.ownerId ?? null,
      visibility: defaultVisibility(scopeType),
      tags: [...new Set(input.tags ?? [])],
      confidence: Math.max(0, Math.min(1, input.confidence ?? 0.7)),
      decayRate: Math.max(0, Math.min(1, input.decayRate ?? 0.002)),
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt ?? null,
      accessCount: 0,
    };
    const rows = read();
    rows.push(memory);
    write(rows);
    return memory;
  },

  recall(opts: {
    query: string;
    principal?: Principal;
    limit?: number;
    now?: number;
  }): RecallResult[] {
    const now = opts.now ?? Date.now();
    this.forget(now);
    const terms = tokenize(opts.query);
    const rows = read().filter((m) => m.status === 'ACTIVE' && allowed(m, opts.principal ?? {}));

    const results = rows
      .map((memory) => {
        const words = tokenize(`${memory.key} ${memory.content} ${memory.tags.join(' ')}`);
        const matches = terms.filter((t) => words.some((w) => w.includes(t) || t.includes(w))).length;
        const relevance = terms.length ? matches / terms.length : 0.25;
        const confidence = effectiveConfidence(memory, now);
        const recency = 1 / (1 + Math.max(0, (now - Date.parse(memory.updatedAt)) / 86400000) / 30);
        const score =
          relevance * 0.5 + confidence * 0.25 + recency * 0.15 + (SCOPE_WEIGHT[memory.scopeType] ?? 0.5) * 0.1;
        return { memory, score: Number(score.toFixed(4)), confidence: Number(confidence.toFixed(4)) };
      })
      .filter((x) => !terms.length || x.score >= 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(100, opts.limit ?? 20)));

    if (results.length) {
      const all = read();
      const ids = new Set(results.map((x) => x.memory.id));
      for (const m of all.filter((x) => ids.has(x.id))) {
        m.accessCount = (m.accessCount ?? 0) + 1;
      }
      write(all);
    }
    return results;
  },

  forget(now: number = Date.now(), minimumConfidence = 0.15): { expired: number; decayed: number } {
    const rows = read();
    let expired = 0;
    let decayed = 0;
    for (const m of rows.filter((x) => x.status === 'ACTIVE')) {
      if (m.expiresAt && Date.parse(m.expiresAt) <= now) {
        m.status = 'EXPIRED';
        expired++;
      } else if (!['DECISION', 'EVIDENCE', 'PROCEDURE'].includes(m.type) && effectiveConfidence(m, now) < minimumConfidence) {
        m.status = 'FORGOTTEN';
        decayed++;
      }
    }
    if (expired || decayed) write(rows);
    return { expired, decayed };
  },

  list(principal?: Principal): Memory[] {
    return read().filter((m) => allowed(m, principal ?? {})).reverse();
  },

  summary() {
    const rows = read();
    return {
      total: rows.length,
      active: rows.filter((x) => x.status === 'ACTIVE').length,
      byScope: Object.fromEntries(SCOPES.map((s) => [s, rows.filter((x) => x.scopeType === s && x.status === 'ACTIVE').length])),
    };
  },

  clear() {
    write([]);
  },
};
