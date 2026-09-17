import type { AppState } from '../types';
import { knowledgeStore } from './knowledge';

/** 三维知识图谱节点：覆盖知识名称、分类、详情、标签、配图、颜色与大小。 */
export interface GraphNode {
  id: string;
  name: string;
  category: string;
  detail: string;
  tags: string[];
  image?: string;
  color: string;
  /** 显示权重，1 为标准大小；渲染时会结合层级做立体缩放。 */
  size: number;
}

export type GraphRelationType = '子类' | '相关' | '因果' | '引用';

export interface GraphLink {
  source: string;
  target: string;
  relationType: GraphRelationType;
  description: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const PALETTE = ['#67e8f9', '#6ee7b7', '#fbbf24', '#f87171', '#a78bfa', '#38bdf8', '#fb7185', '#a3e635'];
const SCHOOL_COLOR: Record<string, string> = {
  儒家: '#f0b429',
  道家: '#6ee7b7',
  佛家: '#fbbf24',
  禅宗: '#c084fc',
  纵横家: '#a78bfa',
  兵家: '#f87171',
  墨家: '#38bdf8',
  法家: '#94a3b8',
  心学: '#fb7185',
  史家: '#a3e635',
  文人: '#fcd34d',
  思想方法与工作方法: '#f87171',
};

function stableColor(seed: string, offset = 0): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PALETTE[(hash + offset) % PALETTE.length];
}

class GraphBuilder {
  nodes: GraphNode[] = [];
  links: GraphLink[] = [];
  private ids = new Set<string>();
  private linkKeys = new Set<string>();

  has(id: string) {
    return this.ids.has(id);
  }

  addNode(node: Omit<GraphNode, 'id'> & { id: string }) {

    if (this.ids.has(node.id)) return;
    this.ids.add(node.id);
    this.nodes.push({ ...node, tags: node.tags.filter(Boolean).slice(0, 8) });
  }

  addLink(source: string, target: string, relationType: GraphRelationType, description: string) {
    if (!source || !target || source === target) return;
    if (!this.ids.has(source) || !this.ids.has(target)) return;
    const key = `${source}\u0000${target}\u0000${relationType}`;
    if (this.linkKeys.has(key)) return;
    this.linkKeys.add(key);
    this.links.push({ source, target, relationType, description });
  }
}

function truncate(value: string, max = 180): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** 从平台真实状态派生三维图谱。数据越多，图越大。 */
export function buildKnowledgeGraph(state: AppState): GraphData {
  const b = new GraphBuilder();

  b.addNode({
    id: 'graph-core',
    name: 'Evo 知识中枢',
    category: '图谱中心',
    detail: '汇聚平台中的先哲思想、组织人事、插件能力、进化过程、协同会话与本地知识库。',
    tags: ['知识库', '自进化', '协同'],
    color: '#67e8f9',
    size: 2.0,
  });

  // ── 先哲、流派与著作 ────────────────────────────────────────────
  const schools = new Map<string, string>();
  for (const sage of state.sages) {
    const schoolId = `school:${sage.school}`;
    if (!schools.has(sage.school)) {
      schools.set(sage.school, schoolId);
      b.addNode({
        id: schoolId,
        name: sage.school,
        category: '思想流派',
        detail: `由 ${state.sages.filter((s) => s.school === sage.school).map((s) => s.name).join('、')} 构成的思想脉络。`,
        tags: ['流派'],
        color: SCHOOL_COLOR[sage.school] ?? stableColor(sage.school),
        size: 1.15,
      });
      b.addLink(schoolId, 'graph-core', '子类', '思想流派属于知识中枢。');
    }

    b.addNode({
      id: sage.id,
      name: sage.name,
      category: '先哲',
      detail: `${sage.alias ? `${sage.alias}。` : ''}${sage.era}。${sage.coreIdeas.join('；')}。思维路径：${sage.thinking.join(' → ')}。`,
      tags: [sage.era, sage.school, ...sage.goodAt],
      color: sage.accent || SCHOOL_COLOR[sage.school] || stableColor(sage.id),
      size: 0.95 + Math.min(0.5, sage.works.length * 0.06 + sage.coreIdeas.length * 0.035),
    });
    b.addLink(sage.id, schoolId, '子类', `${sage.name} 属于${sage.school}。`);
    for (const work of sage.works) {
      const workId = `work:${sage.id}:${work}`;
      b.addNode({
        id: workId,
        name: work,
        category: '经典著作',
        detail: `${sage.name} 的著作或编订文本，可在先哲堂中打开阅读。`,
        tags: [sage.school, '原文'],
        color: sage.accent || stableColor(workId),
        size: 0.72,
      });
      b.addLink(workId, sage.id, '子类', `《${work}》归属 ${sage.name}。`);
      b.addLink(sage.id, workId, '引用', `${sage.name}的思想通过《${work}》传承。`);
    }
  }

  // 常见思想引用：让“引用”关系不只停留在单向归属。
  if (b.has('sage-maozedong') && b.has('sage-simaqian')) {
    b.addLink('sage-maozedong', 'sage-simaqian', '引用', '评点历史人物时直接借取司马迁的历史叙事与人物判断。');
  }
  if (b.has('sage-wangyangming') && b.has('sage-kongzi')) {
    b.addLink('sage-wangyangming', 'sage-kongzi', '引用', '心学的修身功夫上承儒家日用伦常与内省传统。');
  }

  // ── 组织、岗位与人格 ───────────────────────────────────────────
  const departments = new Map<string, string>();
  for (const position of state.positions) {
    const deptId = `dept:${position.department}`;
    if (!departments.has(position.department)) {
      departments.set(position.department, deptId);
      b.addNode({
        id: deptId,
        name: position.department,
        category: '组织部门',
        detail: '由平台岗位组成的组织能力域。',
        tags: ['组织'],
        color: stableColor(position.department),
        size: 1.05,
      });
      b.addLink(deptId, 'graph-core', '子类', '组织能力域属于知识中枢。');
    }
    b.addNode({
      id: `position:${position.id}`,
      name: position.name,
      category: '岗位',
      detail: truncate(position.duties.join('；'), 220),
      tags: [position.category, position.level, ...position.skills.slice(0, 3)],
      color: position.accent || stableColor(position.id),
      size: 0.82,
    });
    b.addLink(`position:${position.id}`, deptId, '子类', `${position.name} 隶属于${position.department}。`);
    if (position.reportsTo) {
      b.addLink(`position:${position.id}`, `position:${position.reportsTo}`, '相关', '岗位汇报与协作关系。');
    }
  }

  for (const persona of state.personas) {
    const position = state.positions.find((p) => p.id === persona.positionId);
    if (!position) continue;
    b.addNode({
      id: `persona:${persona.id}`,
      name: persona.name,
      category: '数字员工',
      detail: `${position.name} 的实例。${persona.traits.join('；')}。`,
      tags: [position.department, ...persona.traits.slice(0, 3)],
      color: position.accent || stableColor(persona.id),
      size: 0.68,
    });
    b.addLink(`persona:${persona.id}`, `position:${position.id}`, '子类', `${persona.name} 是 ${position.name} 的实例。`);
  }

  // ── 插件、能力标签与进化事件 ──────────────────────────────────
  const capabilities = new Map<string, string>();
  for (const plugin of state.plugins) {
    b.addNode({
      id: `plugin:${plugin.id}`,
      name: plugin.name,
      category: '插件工具',
      detail: `${plugin.description} 权限：${plugin.permissions.join('、') || '无'}。`,
      tags: [plugin.status, ...plugin.capabilities],
      color: plugin.status === 'ACTIVE' ? '#6ee7b7' : plugin.status === 'QUARANTINED' ? '#f87171' : '#38bdf8',
      size: 0.78 + plugin.capabilities.length * 0.04,
    });
    b.addLink(`plugin:${plugin.id}`, 'graph-core', '相关', '平台可调用的工具能力。');
    for (const cap of plugin.capabilities) {
      const capId = `capability:${cap}`;
      if (!capabilities.has(cap)) {
        capabilities.set(cap, capId);
        b.addNode({
          id: capId,
          name: cap,
          category: '能力标签',
          detail: '多个插件共同形成的平台能力。',
          tags: ['能力'],
          color: stableColor(cap),
          size: 0.85,
        });
        b.addLink(capId, 'graph-core', '子类', '能力域属于知识中枢。');
      }
      b.addLink(`plugin:${plugin.id}`, capId, '相关', `${plugin.name} 提供 ${cap} 能力。`);
    }
  }

  for (const log of state.evolutionLogs.slice(-160)) {
    const logId = `evolution:${log.id}`;
    const label =
      log.type === 'CAPABILITY_GAP'
        ? '能力缺口'
        : log.type === 'PLUGIN_EVOLVED'
          ? '插件进化'
          : log.type === 'TASK_COMPLETE'
            ? '任务完成'
            : '进化事件';
    b.addNode({
      id: logId,
      name: `${label}：${truncate(log.message, 42)}`,
      category: '进化事件',
      detail: `${new Date(log.at).toLocaleString('zh-CN', { hour12: false })}\n${log.message}`,
      tags: [log.type],
      color:
        log.type === 'CAPABILITY_GAP' || log.type.includes('REPAIR') || log.type.includes('BLOCKED')
          ? '#f87171'
          : log.type === 'TASK_COMPLETE' || log.type === 'REVIEW_APPROVED'
            ? '#6ee7b7'
            : '#38bdf8',
      size: 0.52,
    });
    if (log.pluginId && b.has(`plugin:${log.pluginId}`)) {
      if (log.type === 'CAPABILITY_GAP') {
        b.addLink(logId, `plugin:${log.pluginId}`, '因果', '能力缺口驱动插件与知识结构修正。');
      } else {
        b.addLink(logId, `plugin:${log.pluginId}`, '引用', '进化记录引用插件执行证据。');
      }
    } else {
      b.addLink(logId, 'graph-core', '相关', '平台运行记录沉淀为知识。');
    }
  }

  // ── 会话与参与关系 ─────────────────────────────────────────────
  for (const session of state.sessions.slice(-160)) {
    const sessionId = `session:${session.id}`;
    b.addNode({
      id: sessionId,
      name: truncate(session.title || '协同会话', 42),
      category: '协同会话',
      detail: `${session.messages.length} 条消息，${new Date(session.updatedAt).toLocaleString('zh-CN', { hour12: false })}。最近内容：${truncate(session.messages[session.messages.length - 1]?.content ?? '暂无消息', 180)}`,
      tags: [session.scene, session.policy],
      color: '#93c5fd',
      size: 0.62 + Math.min(0.3, session.messages.length * 0.008),
    });
    for (const participantId of session.participantIds) {
      if (b.has(`persona:${participantId}`)) {
        b.addLink(sessionId, `persona:${participantId}`, '相关', '会话参与关系。');
      }
    }
  }

  // ── 本地知识库：分类与文件 ─────────────────────────────────────
  const categories = knowledgeStore.categories();
  const files = knowledgeStore.files();
  for (const category of categories) {
    b.addNode({
      id: `kb:${category.id}`,
      name: category.name,
      category: '知识分类',
      detail: '本地知识库分类目录，保存于本机不上传服务器。',
      tags: [category.builtin ? '预置' : '自定义'],
      color: '#fbbf24',
      size: 0.92,
    });
    b.addLink(`kb:${category.id}`, 'graph-core', '子类', '知识分类属于本地知识中枢。');
  }

  for (const file of files) {
    const isImage = knowledgeStore.isImage(file);
    b.addNode({
      id: `file:${file.id}`,
      name: file.name,
      category: isImage ? '知识配图' : '知识文件',
      detail: `${truncate(file.name, 160)}\n类型：${file.mime}\n大小：${(file.size / 1024).toFixed(1)} KB\n入库时间：${new Date(file.uploadedAt).toLocaleString('zh-CN', { hour12: false })}`,
      tags: [file.mime, isImage ? '图片' : '文档'],
      image: isImage ? file.dataUrl : undefined,
      color: isImage ? '#fb7185' : '#fcd34d',
      size: 0.56 + Math.min(0.24, Math.log10(file.size + 1) * 0.05),
    });
    if (b.has(`kb:${file.categoryId}`)) {
      b.addLink(`file:${file.id}`, `kb:${file.categoryId}`, '子类', '知识文件归属分类目录。');
    }
  }

  // 去掉无任何连接的节点，避免噪声把悬浮结构挤散。
  const connected = new Set(b.links.flatMap((l) => [l.source, l.target]));
  return {
    nodes: b.nodes.filter((n) => n.id === 'graph-core' || connected.has(n.id)),
    links: b.links,
  };
}

/** 前端图例使用的分类顺序。 */
export function graphCategories(data: GraphData): { name: string; color: string; count: number }[] {
  const map = new Map<string, { name: string; color: string; count: number }>();
  for (const node of data.nodes) {
    const item = map.get(node.category) ?? { name: node.category, color: node.color, count: 0 };
    item.count += 1;
    map.set(node.category, item);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
