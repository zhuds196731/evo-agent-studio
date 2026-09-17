import type { LlmConfig, Position } from '../types';
import { generate } from './llm';

const PALETTE = ['#5b7cfa', '#22c98a', '#f5a524', '#ff7ab6', '#7c9cff', '#c792ea', '#74c7ff', '#ffd166'];

export interface PositionDraft extends Position {}

/**
 * 由一句话描述生成岗位草稿：
 * - 配置了模型时交给模型产出结构化字段
 * - 未配置时用规则模板补齐，保证离线也能"说一句就建岗"
 */
export async function draftPosition(raw: string, config: LlmConfig): Promise<PositionDraft> {
  const topic = raw.trim().slice(0, 40) || '新岗位';
  const fallback = ruleBasedDraft(topic, raw);

  if (config.enabled && config.apiKey) {
    try {
      const { text } = await generate(
        {
          system:
            '你是组织设计专家。根据用户的岗位描述输出严格的 JSON，字段：name, department, category(分类：高层管理/财务类/技术类/产品类/市场运营类/艺术设计类 之一), level, duties(数组), skills(数组), kpis(数组), tone, avatarPrompt。不要输出任何解释或代码块标记。',
          history: [],
          prompt: raw,
          temperature: 0.4,
        },
        config,
      );
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim()) as Partial<Position>;
      return {
        ...fallback,
        name: parsed.name || fallback.name,
        department: parsed.department || fallback.department,
        category: parsed.category || fallback.category,
        level: parsed.level || fallback.level,
        duties: parsed.duties?.length ? parsed.duties : fallback.duties,
        skills: parsed.skills?.length ? parsed.skills : fallback.skills,
        kpis: parsed.kpis?.length ? parsed.kpis : fallback.kpis,
        tone: parsed.tone || fallback.tone,
        avatarPrompt: parsed.avatarPrompt || fallback.avatarPrompt,
      };
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function ruleBasedDraft(topic: string, raw: string): PositionDraft {
  const name = topic.length > 12 ? topic.slice(0, 12) : topic;
  return {
    id: '',
    name,
    department: guessDepartment(raw),
    category: guessCategory(raw),
    level: 'L5',
    duties: [
      `围绕「${name}」制定目标与计划并推进落地`,
      `负责${name}相关事项的日常执行与质量把关`,
      `沉淀${name}的方法论、规范与协作接口`,
    ],
    skills: [`${name}专业能力`, '跨部门协作', '数据化复盘'],
    kpis: ['任务按时交付率', '结果质量评分', '协作方满意度'],
    tone: '专业直接，结论先行，给出可执行动作',
    avatarPrompt: `二次元半写实风格职业形象，符合「${name}」岗位气质，柔和光线，高清细腻`,
    avatarEmoji: '🧩',
    accent: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    builtin: false,
  };
}

function guessCategory(raw: string): string {
  if (/董事长|总经理|总裁|总监|高管|决策/.test(raw)) return '高层管理';
  if (/财务|会计|出纳|税务|审计|成本|预算|资金/.test(raw)) return '财务类';
  if (/研发|技术|架构|代码|测试|运维|数据|分析/.test(raw)) return '技术类';
  if (/产品|需求|用户研究/.test(raw)) return '产品类';
  if (/市场|品牌|增长|投放|运营|销售|客户|商务|新媒体/.test(raw)) return '市场运营类';
  if (/设计|视觉|美术|插画|文案|创意|艺术/.test(raw)) return '艺术设计类';
  return '产品类';
}

function guessDepartment(raw: string): string {
  if (/研发|技术|架构|代码|测试/.test(raw)) return '技术中心';
  if (/市场|品牌|增长|投放|运营/.test(raw)) return '市场中心';
  if (/财务|成本|预算|资金/.test(raw)) return '财务中心';
  if (/人力|招聘|绩效|组织|文化/.test(raw)) return '组织中心';
  if (/销售|客户|商务|签约/.test(raw)) return '销售中心';
  if (/数据|分析|指标/.test(raw)) return '数据中心';
  if (/产品|需求|用户/.test(raw)) return '产品中心';
  return '自定义';
}
