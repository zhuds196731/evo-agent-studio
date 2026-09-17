import type { AlphaSageRun } from '../types';

export type InvestmentAiMode = 'strict-no-judgment' | 'strict-judgment' | 'exploratory';

export type InvestmentAiFocus =
  | 'comprehensive'
  | 'macro'
  | 'industry'
  | 'fundamental'
  | 'technical'
  | 'sentiment'
  | 'risk'
  | 'bias';

export const INVESTMENT_AI_MODE_LABEL: Record<InvestmentAiMode, string> = {
  'strict-no-judgment': '严格不判断',
  'strict-judgment': '严格判断',
  exploratory: '沙盘推演',
};

export const INVESTMENT_AI_FOCUS_LABEL: Record<InvestmentAiFocus, string> = {
  comprehensive: '综合复盘',
  macro: '宏观视角',
  industry: '行业资金',
  fundamental: '基本面',
  technical: '技术面',
  sentiment: '市场情绪',
  risk: '风控执行',
  bias: '偏差审计',
};

function csvTail(text: string, rows = 3): string {
  const lines = String(text ?? '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return '未提供';
  return [lines[0], ...lines.slice(-rows)].join('；');
}

function csvRowCount(text: string): number {
  return Math.max(0, String(text ?? '').split(/\r?\n/).filter(Boolean).length - 1);
}

function modePolicy(mode: InvestmentAiMode): string {
  if (mode === 'strict-no-judgment') {
    return [
      '[模式：严格不判断]',
      '- 只输出数据审计、客观事实、数据分析、条件触发型建议、风险与不确定性、结论。',
      '- 不得给出买入、卖出、上涨、下跌等确定性预测。',
      '- 允许的建议只能是：如果发生 A，且满足 B，则可以考虑 C。',
      '- 不允许用“可能、大概率、感觉、应该”替代明确数据条件。',
      '- 数据不足时宁可不输出建议，也不用叙事补齐。',
    ].join('\n');
  }

  if (mode === 'strict-judgment') {
    return [
      '[模式：严格判断]',
      '- 可以给出有限判断和条件预测，但每个判断必须引用指标、样本、时间戳或公式结果。',
      '- 预测必须写成：如果未来出现 A、B，则可能验证 C；并说明验证方式。',
      '- 不得使用无来源信息；不得把模糊表述当成判断依据。',
      '- 数据不足或信号冲突时必须降级为“当前数据不具备判断条件”。',
    ].join('\n');
  }

  return [
    '[模式：沙盘推演]',
    '- 可以做探索性推导，但必须把结论标注为“推测”。',
    '- 每条推测都要说明依据来自哪一层数据。',
    '- 未被数据完全证实的内容不得写成结论。',
    '- 仍严禁编造数据、编造来源或假设用户没有提供的财务事件。',
  ].join('\n');
}

function focusPolicy(focus: InvestmentAiFocus): string {
  const map: Record<InvestmentAiFocus, string> = {
    comprehensive: '以研究经理视角收敛多空证据，先指出冲突，再给出结构化复盘。',
    macro: '以宏观分析师视角检查利率、通胀、大盘趋势和外部风险，不讨论个股题材。',
    industry: '以行业景气分析师视角检查行业强度、资金流、拥挤度和估值分位。',
    fundamental: '以基本面分析师视角检查盈利质量、现金流、应收变化和估值证据。',
    technical: '以技术量化分析师视角解释代码层指标，不凭感觉画趋势线。',
    sentiment: '以情绪分析师视角检查涨跌停结构、情绪极端性和羊群效应。',
    risk: '以保守风控视角优先检查止损、最大回撤、仓位约束和否决条件。',
    bias: '以认知偏差审计师视角检查锚定、损失厌恶、羊群效应和沉没成本叙事。',
  };
  return `[视角：${INVESTMENT_AI_FOCUS_LABEL[focus]}] ${map[focus]}`;
}

export function buildInvestmentAiSystem(
  run: AlphaSageRun | null,
  mode: InvestmentAiMode,
  focus: InvestmentAiFocus,
): string {
  return [
    '你是 AlphaSage 投资问话助手，服务于投资分析栏目的复盘、解释与情景推演。',
    '你的职责是解释已经由代码计算出的指标，组织多空证据，帮助用户检查决策质量。',
    '你不直接替代 AlphaSage 的确定性计算，也不参与真实交易执行。',
    '',
    '[全局硬约束]',
    '1. 禁止编造、补全或假设任何数据。',
    '2. 禁止使用未在证据包中提供或未标明来源的信息。',
    '3. 禁止重新计算复杂金融指标；只能解释证据包中的计算结果。',
    '4. 所有数学结论必须能对应到指标表、原始数据或审计记录。',
    '5. 用户风控参数不可被推翻；止损和最大回撤缺失时必须提示风险。',
    '6. 不提供真实下单指令，不连接交易执行。',
    '',
    modePolicy(mode),
    '',
    focusPolicy(focus),
    '',
    '[输出结构]',
    '一、数据审计：完整性、一致性、时效性、异常值。',
    '二、客观事实：只列证据包中的数据。',
    '三、数据分析：按用户关注视角解释量价、结构、行为特征。',
    '四、判断 / 条件化建议：遵守当前模式的约束。',
    '五、风险与不确定性：列冲突、缺失层、极端情景。',
    '六、结论：只给可确认内容或明确说明无法判断。',
    '',
    run ? buildEvidencePack(run) : '[证据包] 当前没有 AlphaSage 报告。只能说明缺少五层证据，不得虚构分析。',
  ].join('\n');
}

export function buildEvidencePack(run: AlphaSageRun): string {
  const okLayers = new Set(run.metrics.filter((item) => item.status === 'OK').map((item) => item.layer));
  const layerSummary = ['macro', 'industry', 'fundamental', 'technical', 'sentiment']
    .map((layer) => `${layer}:${okLayers.has(layer as AlphaSageRun['metrics'][number]['layer']) ? 'OK' : 'MISSING'}`)
    .join('，');

  const metricLines = run.metrics.map((metric) => {
    const value = metric.value === undefined ? '' : ` value=${metric.value}${metric.unit ?? ''}`;
    return `- ${metric.id}｜${metric.name}｜${metric.layer}｜status=${metric.status}｜signal=${metric.signal.toFixed(3)}${value}｜formula=${metric.formula}`;
  });

  const reportLines = run.reports.map((report) => {
    const evidence = report.evidence.slice(0, 2).join('；');
    return `- ${report.agentName}｜${report.decision}｜${report.conclusion}｜证据：${evidence || '无'}`;
  });

  const auditLines = run.audit.slice(-8).map((item) => `- ${item.at}｜${item.actor}｜${item.action}｜${item.detail}`);
  const decision = run.decision;

  return [
    '[证据包开始]',
    `标的：${run.target}`,
    `研究周期：${run.horizon}；风险偏好：${run.riskProfile}`,
    `风控约束：最大仓位=${decision.positionSize}%；止损=${decision.stopLoss ?? '未设置'}；最大回撤=${decision.maxDrawdown ?? '未设置'}`,
    `用户补充约束：${run.input.note || '无'}`,
    `报告状态：${run.status}；一票否决=${decision.veto ? '是' : '否'}`,
    `最终决策：方向=${decision.direction}；建议仓位=${decision.positionSize}%；置信度=${decision.confidence}%；综合信号=${decision.score.toFixed(3)}`,
    `决策警告：${decision.warnings.join('；') || '无'}`,
    `理由链：${decision.reasonChain.join('；')}`,
    `五层完整性：${layerSummary}`,
    '',
    '[指标表]',
    metricLines.length ? metricLines.join('\n') : '- 无',
    '',
    '[智能体报告]',
    reportLines.length ? reportLines.join('\n') : '- 无',
    '',
    '[原始数据样本]',
    `宏观：${csvRowCount(run.input.macro)} 行；${csvTail(run.input.macro)}`,
    `行业资金：${csvRowCount(run.input.industry)} 行；${csvTail(run.input.industry)}`,
    `基本面：${csvRowCount(run.input.fundamental)} 行；${csvTail(run.input.fundamental)}`,
    `行情OHLCV：${csvRowCount(run.input.ohlcv)} 行；${csvTail(run.input.ohlcv)}`,
    `市场情绪：${csvRowCount(run.input.sentiment)} 行；${csvTail(run.input.sentiment)}`,
    '',
    '[审计尾部]',
    auditLines.length ? auditLines.join('\n') : '- 无',
    '[证据包结束]',
  ].join('\n');
}
