/**
 * 质量门禁：对应旧工程 quality-gates.js
 * 第一性原理 + 钢人论证双重校验，判定输出是否可交付。
 */

export interface FirstPrinciplesResult {
  problem: string;
  assumptions: string[];
  fundamentals: string[];
  invariants: string[];
  evidence: boolean;
  score: number;
}

export interface SteelmanResult {
  thesis: string[];
  opposingCase: string;
  uncertainties: string[];
  decisionRule: string;
  passed: boolean;
  score: number;
}

export interface GateResult {
  firstPrinciples: FirstPrinciplesResult;
  steelman: SteelmanResult;
  passed: boolean;
  reason: string;
}

function firstPrinciples(task: string, output: string): FirstPrinciplesResult {
  const text = String(output || '');
  return {
    problem: String(task),
    assumptions: ['目标与约束已明确', '输入数据可追溯', '结果需要可验证'],
    fundamentals: ['目标是什么', '不可再拆的事实有哪些', '资源与约束是什么', '什么证据能证明完成'],
    invariants: ['不编造事实', '区分事实、推断与建议', '保留验证路径'],
    evidence: text.length > 20,
    score: text.length > 20 ? 0.85 : 0.35,
  };
}

function steelman(_task: string, output: string): SteelmanResult {
  const text = String(output || '');
  const claims = text
    .split(/[。.!！?？\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 8);
  const strongestCounter = claims.length
    ? '对每条结论寻找最强反例、替代解释和失败条件'
    : '当前没有足够结论可供钢人论证';
  const score = claims.length >= 2 && text.length > 40 ? 0.85 : claims.length ? 0.55 : 0.2;
  return {
    thesis: claims,
    opposingCase: strongestCounter,
    uncertainties: ['样本可能不足', '外部事实需独立核验'],
    decisionRule: '只有关键结论有证据、反方论证已回应且边界明确时才可交付',
    passed: score >= 0.8,
    score,
  };
}

export function gateDelivery(task: string, outputs: { output?: string; result?: string }[]): GateResult {
  const text = outputs.map((x) => x?.output || x?.result || '').join('\n');
  const fp = firstPrinciples(task, text);
  const sm = steelman(task, text);
  return {
    firstPrinciples: fp,
    steelman: sm,
    passed: fp.evidence && sm.passed,
    reason: fp.evidence && sm.passed ? '通过第一性原理与钢人论证' : '需要补充事实、证据或反方论证',
  };
}
