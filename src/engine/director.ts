import type {
  AppState,
  ChatMessage,
  LlmConfig,
  Persona,
  Position,
  Sage,
  Session,
} from '../types';
import { generate, type LlmTurn } from './llm';
import { memoryStore } from './memory';
import { newMessage } from '../store/storage';
import { routeModel } from './providers';
import { invokePlugin } from './plugins';
import { renderResearchBlock, researchHistory } from './historyResearch';

export const SCENE_LABEL: Record<Session['scene'], string> = {
  solo: '单人对话',
  p2p: '单人对单人',
  p2g: '单人对多人',
  g2g: '小组对小组',
  report: '下级向上级汇报',
  inquiry: '上级向下级了解情况',
  consult: '先哲思想咨询',
};

export const SCENE_HINT: Record<Session['scene'], string> = {
  solo: '你与一位数字员工一对一沟通，适合布置任务、追问细节。',
  p2p: '两个岗位角色就同一议题对谈，你可在旁观察或随时插入。',
  p2g: '一人面向一组人发言（如 CEO 对全员、PM 对研发组），组内成员逐个回应。',
  g2g: '两个小组（如产品组 vs 技术组）展开攻防与协商，各自派代表发言。',
  report: '下级按"结论—进展—风险—请求支持"结构化汇报，上级给出批复与决策。',
  inquiry: '上级主动向下级了解情况，下级逐条答复，上级最后收敛。',
  consult: '向先哲请教，每位先哲按其独有的思维框架回应你的困惑。',
};

export function personaOf(state: AppState, id: string): Persona | undefined {
  return state.personas.find((p) => p.id === id);
}

export function positionOf(state: AppState, persona: Persona): Position | undefined {
  return state.positions.find((p) => p.id === persona.positionId);
}

export function buildPersonaSystem(
  persona: Persona,
  position: Position | undefined,
  superior?: string,
): string {
  const traits = persona.traits.length ? `、${persona.traits.join('、')}` : '';
  return [
    `你是「${persona.name}」，岗位：${position?.name ?? '未指定'}（${position?.department ?? '-'} / ${position?.level ?? '-'}）。`,
    `职责：${position?.duties.join('；') ?? '完成本职目标'}。`,
    `专长：${position?.skills.join('、') ?? '通用能力'}。`,
    `指标：${position?.kpis.join('、') ?? '结果达成'}。`,
    superior ? `你的上级：${superior}。` : '',
    `语气：${position?.tone ?? '专业、直接'}${traits}。`,
    '要求：始终站在该岗位真实立场发言，有自己的判断与取舍，可以提出反对意见；不要复述用户的话。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildSageSystem(sage: Sage): string {
  return [
    `你化身为${sage.era}的${sage.name}（${sage.alias ?? ''}），学派：${sage.school}。`,
    `核心思想：${sage.coreIdeas.join('、')}。`,
    `思维框架：${sage.thinking.join('；')}。`,
    `语气：${sage.speakingStyle}。`,
    `代表著述：${sage.works.join('、')}。`,
    '要求：用该思想家的视角与语言习惯回应，可引用其原话；回答要有思想纵深，也要落到提问者当下可践行的一步。不要自称 AI。',
  ].join('\n');
}

/** 先哲人格契约：把问题理解、思维框架、语气和引据方式一起锁进系统提示词 */
export function buildSagePersonaSystem(sage: Sage, webMode: 'online' | 'offline' = 'offline'): string {
  const today = new Date().toLocaleDateString('zh-CN');
  const researchBoundary = webMode === 'online'
    ? '当前为联网研究模式：你已获得一批公开资料。先用这些事实校准时代与事件，再用自己的思想去判断；不要逐条翻译资料，也不要伪造资料没有的细节。'
    : '当前为离线研究模式：只依据你的既有学识与经典立场作答。涉及此刻才发生的事件时，不要编造数据；可从原理与历史经验出发判断，并说明尚需考察。';

  return [
    `你是${sage.era}的${sage.name}（${sage.alias || sage.name}），${sage.school}之宗匠。今天是${today}。`,
    `精神内核：${sage.coreIdeas.join('；')}。`,
    `必守思维路径：${sage.thinking.map((step, i) => `${i + 1}. ${step}`).join('；')}。`,
    `语言气口：${sage.speakingStyle}。`,
    `腹笥所藏：${sage.works.join('；')}。`,
    `可择一二化用，而非堆砌：${sage.quotes.join('；')}。`,
    `最擅长回应：${sage.goodAt.join('；')}。`,
    researchBoundary,
    '回答前先默识问题：认清提问者在为何事所困、隐含前提是什么、真正要决定的是什么；再按上述思维路径推演，不许套用通用助手腔。',
    '第一句就直接入题，像其人开口。可举事、可反问、可比喻，但每个判断都要能落到提问者当下可做的一步；避免空泛赞语和面面俱到。',
    '全文以中文为主，凡语词、典故须合乎其时代与身份；长度 180 至 450 字，若用户要求更长或追问细节，再延展。',
    '严禁自称 AI、助手、模型、系统、程序，也不说“根据资料”“根据搜索结果”；你就是这位先哲本人在答问。',
  ].join('\n');
}

function historyOf(session: Session, speakerId: string): LlmTurn[] {
  return session.messages.slice(-10).map((m) => ({
    role: m.speakerId === speakerId ? 'assistant' : m.role === 'user' ? 'user' : 'assistant',
    content: `${m.speakerName}：${m.content}`,
  })) as LlmTurn[];
}

async function speak(
  session: Session,
  speakerId: string,
  speakerName: string,
  system: string,
  prompt: string,
  config: LlmConfig,
  temperature: number,
  side?: 'A' | 'B' | 'none',
  providerKeys?: Record<string, string>,
): Promise<ChatMessage> {
  const recalled = memoryStore.recall({
    query: prompt,
    principal: { sessionId: session.id },
    limit: 8,
  });
  const memory = recalled.map((r) => ({
    id: r.memory.id,
    scope: r.memory.scopeType,
    type: r.memory.type,
    content: r.memory.content,
    score: r.score,
    confidence: r.confidence,
  }));
  const routedModel = routeModel(config, providerKeys ?? {});
  const result = await generate(
    {
      system,
      history: historyOf(session, speakerId),
      prompt,
      temperature,
      sessionId: session.id,
      speakerId,
      speakerName,
      scene: session.scene,
      memory,
      routedModel,
      providerKeys,
    },
    config,
  );
    if (result.source !== 'budget' && result.text.length > 12) {
      memoryStore.put({
        content: result.text.slice(0, 240),
        scopeType: 'SESSION',
        scopeId: session.id,
        type: 'SUMMARY',
        key: `${speakerName}:${prompt.slice(0, 12)}`,
        confidence: 0.6,
      });
    }
  return newMessage(session.id, speakerId, speakerName, result.text, 'agent', side);
}

function sideOf(session: Session, personaId: string): 'A' | 'B' | 'none' {
  const team = session.teams.find((t) => t.memberIds.includes(personaId));
  return team?.side ?? 'none';
}

/** 按岗位汇报关系找上级人物 id */
export function supervisorOf(state: AppState, persona: Persona): Persona | undefined {
  const pos = positionOf(state, persona);
  if (!pos?.reportsTo) return undefined;
  return state.personas.find((p) => p.positionId === pos.reportsTo);
}

export function subordinatesOf(state: AppState, persona: Persona): Persona[] {
  const pos = positionOf(state, persona);
  if (!pos) return [];
  return state.personas.filter((p) => {
    const ppos = positionOf(state, p);
    return ppos?.reportsTo === pos.id;
  });
}

export interface TurnResult {
  messages: ChatMessage[];
}

/** 插件调用记录：供系统通知与提示词注入 */
interface PluginCallRecord {
  name: string;
  ok: boolean;
  output: string;
}

/**
 * 根据用户输入自动匹配并调用 ACTIVE 插件（能力标签双向包含匹配）。
 * 每轮最多调用 3 个插件，结果注入发言者系统提示词，实现"对话中自动使用工具"。
 */
async function autoInvokePlugins(
  state: AppState,
  session: Session,
  userInput: string,
): Promise<PluginCallRecord[]> {
  const active = (state.plugins ?? []).filter((p) => p.status === 'ACTIVE');
  if (!active.length || !userInput.trim()) return [];

  const keywords = userInput.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  if (!keywords.length) return [];

  const haystack = userInput.toLowerCase();
  const scored = active
    .map((plugin) => {
      const score = plugin.capabilities.reduce((sum, cap) => {
        const c = cap.toLowerCase();
        const phraseHit = c.length > 1 && haystack.includes(c);
        const keywordHit = keywords.some((k) => c.includes(k) || k.includes(c));
        return sum + (phraseHit || keywordHit ? 1 : 0);
      }, 0);
      return { plugin, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  const invoked: PluginCallRecord[] = [];
  for (const { plugin } of scored) {
    const res = await invokePlugin(state.plugins ?? [], plugin.id, {
      task: userInput,
      text: userInput,
      sessionId: session.id,
    });
    invoked.push({
      name: plugin.name,
      ok: res.ok,
      output: (res.output ?? res.error ?? '').slice(0, 1800),
    });
    if (invoked.length >= 3) break;
  }
  return invoked;
}

/**
 * 一轮对话的调度核心：根据场景决定"谁说、按什么顺序说、说什么结构"。
 */
export async function runTurn(
  state: AppState,
  session: Session,
  userInput: string,
): Promise<TurnResult> {
  const config = state.llm;
  const result: ChatMessage[] = [];
  const ids = session.participantIds;

  // 先自动匹配并调用插件
  const pluginCalls = await autoInvokePlugins(state, session, userInput);
  if (pluginCalls.length) {
    const notice = newMessage(
      session.id,
      'system',
      '插件工具',
      `已自动调用 ${pluginCalls.length} 个插件：${pluginCalls.map((r) => r.name).join('、')}`,
      'system',
    );
    result.push(notice);
    session.messages.push(notice);
  }
  const pluginExtra = pluginCalls.length
    ? `\n[插件工具结果]\n${pluginCalls.map((r) => `[${r.name}] ${r.output}`).join('\n')}`
    : '';

  const personaById = (id: string) => personaOf(state, id);

  const emit = async (persona: Persona, prompt: string, extra?: string) => {
    const pos = positionOf(state, persona);
    const sup = supervisorOf(state, persona);
    const system =
      buildPersonaSystem(persona, pos, sup?.name) +
      (extra ? `\n${extra}` : '') +
      pluginExtra;
    const msg = await speak(
      session,
      persona.id,
      persona.name,
      system,
      prompt || userInput,
      config,
      persona.temperature,
      sideOf(session, persona.id),
      state.providerKeys,
    );
    result.push(msg);
    session.messages.push(msg);
    return msg;
  };

  try {
    switch (session.scene) {
    case 'solo': {
      const p = personaById(ids[0]);
      if (p) await emit(p, userInput);
      break;
    }

    case 'p2p': {
      const [a, b] = ids.map(personaById);
      if (a) await emit(a, userInput);
      if (b) {
        await emit(
          b,
          `请针对上述议题给出你的判断与回应，可以适当反驳或补充。`,
        );
      }
      break;
    }

    case 'p2g': {
      const [lead, ...group] = ids.map(personaById).filter(Boolean) as Persona[];
      if (lead) await emit(lead, userInput);
      for (const member of group.slice(0, 5)) {
        await emit(member, `请从你的岗位角度回应上述内容，给出可执行的一条动作。`);
      }
      break;
    }

    case 'g2g': {
      const teamA = session.teams.find((t) => t.side === 'A');
      const teamB = session.teams.find((t) => t.side === 'B');
      const repsA = (teamA?.memberIds ?? ids.slice(0, Math.ceil(ids.length / 2)))
        .map(personaById)
        .filter(Boolean) as Persona[];
      const repsB = (teamB?.memberIds ?? ids.slice(Math.ceil(ids.length / 2)))
        .map(personaById)
        .filter(Boolean) as Persona[];
      const rounds = 2;
      for (let r = 0; r < rounds; r += 1) {
        for (const p of repsA.slice(0, 3)) {
          await emit(p, r === 0 ? userInput : `针对对方上一轮观点做出回应与让步/坚持的判断。`, `小组：${teamA?.name ?? 'A 组'}`);
        }
        for (const p of repsB.slice(0, 3)) {
          await emit(p, `站在本组立场回应对方，明确指出分歧点与可调和处。`, `小组：${teamB?.name ?? 'B 组'}`);
        }
      }
      break;
    }

    case 'report': {
      const [sub, sup] = ids.map(personaById);
      if (sub) {
        await emit(
          sub,
          userInput,
          '输出结构：1) 结论先行 2) 关键进展（带数字）3) 风险与卡点 4) 需要上级决策或支持的事项。',
        );
      }
      if (sup) {
        await emit(
          sup,
          `请以${positionOf(state, sup)?.name ?? '上级'}身份给出批复：肯定或纠正、追问关键信息、明确决策与时间点。`,
        );
      }
      break;
    }

    case 'inquiry': {
      const [sup, ...subs] = ids.map(personaById).filter(Boolean) as Persona[];
      if (sup) {
        await emit(
          sup,
          userInput || '请逐项了解当前进展：指标完成情况、卡点、需要的支持。',
          '以提问为主，一次最多三个问题，语气体现关心与追责并重。',
        );
      }
      for (const sub of subs.slice(0, 4)) {
        await emit(sub, `如实答复上级问询：先给结论，再给事实与数字，不隐瞒风险。`, '输出结构：结论 / 事实 / 风险 / 需要的支持。');
      }
      break;
    }

    case 'consult': {
      const sage = state.sages.find((s) => `sage-${s.id}` === ids[0] || s.id === ids[0]);
      if (sage) {
        const webMode = session.webMode === 'offline' ? 'offline' : 'online';
        let system = buildSagePersonaSystem(sage, webMode);
        // 隐藏式研究管道：历史/人物点评类（含刁钻问题）后台静默检索网络资料，
        // 由大模型筛选融合后以先哲口吻回答；失败静默降级，用户无感
        try {
          if (webMode === 'online') {
            const refs = await researchHistory(userInput);
            const block = renderResearchBlock(refs);
            if (block) system += block;
            const notice = newMessage(
              session.id,
              'system',
              '系统提示',
              refs.length
                ? `联网模式：已获取 ${refs.length} 条公开资料，交由${sage.name}消化后作答。`
                : `联网模式：暂未检索到相关公开资料，${sage.name}将按既有学识作答。`,
              'system',
            );
            result.push(notice);
            session.messages.push(notice);
          } else {
            const notice = newMessage(
              session.id,
              'system',
              '系统提示',
              `离线模式：${sage.name}仅依据既有学识与经典立场作答。`,
              'system',
            );
            result.push(notice);
            session.messages.push(notice);
          }
        } catch {
          /* 联网失败时不阻断对话；资料不足时由先哲按既有学识回答 */
        }
        const routedModel = routeModel(config, state.providerKeys);
        const { text } = await generate(
          {
            system,
            history: historyOf(session, sage.id),
            prompt: userInput,
            temperature: 0.8,
            routedModel,
            providerKeys: state.providerKeys,
          },
          config,
        );
        const msg = newMessage(session.id, sage.id, sage.name, text, 'agent');
        result.push(msg);
        session.messages.push(msg);
      }
      break;
    }
    }
  } catch (e) {
    // 兜底：任何异常都转为可见的系统消息，绝不无声无息
    const reason = (e as Error)?.message ?? String(e);
    console.error('[director] 本轮生成异常：', e);
    const notice = newMessage(
      session.id,
      'system',
      '系统提示',
      `⚠️ 本轮生成失败：${reason}。请检查「设置」中的模型配置与网络后重试；未配置模型时会自动打开 API 设置。`,
      'system',
    );
    result.push(notice);
    session.messages.push(notice);
  }

  session.updatedAt = Date.now();
  return { messages: result };
}

/** 场景推荐参与者：report/inquiry 自动按汇报关系配对 */
export function suggestParticipants(
  state: AppState,
  scene: Session['scene'],
  anchorId?: string,
): string[] {
  const anchor = anchorId ? personaOf(state, anchorId) : undefined;
  if (scene === 'report' && anchor) {
    const sup = supervisorOf(state, anchor);
    return sup ? [anchor.id, sup.id] : [anchor.id];
  }
  if (scene === 'inquiry' && anchor) {
    const subs = subordinatesOf(state, anchor);
    return [anchor.id, ...subs.slice(0, 3).map((p) => p.id)];
  }
  if (scene === 'p2g' && anchor) {
    const pos = positionOf(state, anchor);
    const sameDept = state.personas.filter(
      (p) => p.id !== anchor.id && positionOf(state, p)?.department === pos?.department,
    );
    return [anchor.id, ...sameDept.slice(0, 3).map((p) => p.id)];
  }
  return anchor ? [anchor.id] : [];
}
