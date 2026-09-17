import type {
  AlphaSageAgentReport,
  AlphaSageAuditEvent,
  AlphaSageDecision,
  AlphaSageDomain,
  AlphaSageInput,
  AlphaSageMetric,
  AlphaSageRun,
  AppState,
} from '../types';
import { ALPHASAGE_POSITIONS } from '../data/alphasage';

/**
 * AlphaSage 定稿版流水线：17 个智能体按四域协同。
 * 金融算术全部由本文件的纯代码函数完成；LLM 只能做后续逻辑解释，
 * 不能参与指标计算，也不能把缺失数据补成猜测值。
 */

type PositionMap = Map<string, { name: string; accent: string; emoji: string }>;

interface CsvRow {
  [key: string]: string;
}

interface DomainScore {
  score: number;
  okCount: number;
  totalCount: number;
}

const LAYER_WEIGHTS: Record<AlphaSageMetric['layer'], number> = {
  macro: 0.3,
  industry: 0.25,
  fundamental: 0.2,
  technical: 0.15,
  sentiment: 0.1,
};

const LAYER_LABELS: Record<AlphaSageMetric['layer'], string> = {
  macro: '宏观',
  industry: '行业',
  fundamental: '基本面',
  technical: '技术面',
  sentiment: '情绪',
};


function parseCsv(text: string): CsvRow[] {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const header = lines[0]
    .split(delimiter)
    .map((cell) => cell.trim().toLowerCase().replace(/\s+/g, '_').normalize('NFC'));
  return lines.slice(1).map((line) => {
    const cells = line.split(delimiter).map((cell) => cell.trim());
    const row: CsvRow = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? '';
    });
    return row;
  });
}

function numberOf(value: string | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const cleaned = String(value)
    .normalize('NFC')
    .replace(/[，,]/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace('%', '')
    .replace(/[^\d.+-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '+') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function last<T>(list: T[]): T | undefined {
  return list[list.length - 1];
}

function sma(values: number[], window: number): number | null {
  if (values.length < window || window <= 0) return null;
  const slice = values.slice(-window);
  return slice.reduce((sum, value) => sum + value, 0) / window;
}

function ema(values: number[], window: number): number[] {
  const k = 2 / (window + 1);
  const output: number[] = [];
  let previous = values[0] ?? 0;
  values.forEach((value, index) => {
    previous = index === 0 ? value : value * k + previous * (1 - k);
    output.push(previous);
  });
  return output;
}

function stdev(values: number[], window: number): number | null {
  if (values.length < window) return null;
  const slice = values.slice(-window);
  const mean = slice.reduce((sum, value) => sum + value, 0) / window;
  const variance = slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window;
  return Math.sqrt(variance);
}

function rsi(closes: number[], window = 14): number | null {
  if (closes.length < window + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= window; i += 1) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / window;
  let avgLoss = loss / window;
  for (let i = window + 1; i < closes.length; i += 1) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (window - 1) + Math.max(0, delta)) / window;
    avgLoss = (avgLoss * (window - 1) + Math.max(0, -delta)) / window;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function macdHistogram(closes: number[]): number | null {
  if (closes.length < 35) return null;
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const dif = ema12.map((value, index) => value - ema26[index]);
  const dea = ema(dif.slice(-Math.min(dif.length, 9)), 9);
  return ((last(dif) ?? 0) - (last(dea) ?? 0)) * 2;
}

function bollingerPosition(closes: number[], window = 20): number | null {
  const mean = sma(closes, window);
  const sd = stdev(closes, window);
  const price = last(closes);
  if (mean === null || sd === null || price === undefined || sd === 0) return null;
  return (price - (mean - 2 * sd)) / (4 * sd);
}

function returnOver(values: number[], window: number): number | null {
  if (values.length < window + 1) return null;
  const base = values[values.length - window - 1];
  return base === 0 ? null : (last(values)! - base) / base;
}

function clampSignal(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function makeMetric(
  id: string,
  name: string,
  layer: AlphaSageMetric['layer'],
  formula: string,
  samples: number,
  minSamples: number,
  compute: () => { signal: number; value?: number; unit?: string; evidence?: string } | null,
  missingReason = '样本数不足或必要列缺失',
): AlphaSageMetric {
  if (samples < minSamples) {
    return { id, name, layer, status: 'INSUFFICIENT_DATA', signal: 0, samples, reason: missingReason, formula };
  }
  const result = compute();
  if (!result || !Number.isFinite(result.signal)) {
    return { id, name, layer, status: 'INSUFFICIENT_DATA', signal: 0, samples, reason: missingReason, formula };
  }
  return {
    id,
    name,
    layer,
    status: 'OK',
    signal: clampSignal(result.signal),
    value: result.value,
    unit: result.unit,
    samples,
    formula,
    evidence: result.evidence,
  };
}

function hasDateColumn(rows: CsvRow[]): boolean {
  return rows.some((row) => Object.keys(row).some((key) => key.includes('date') || key.includes('time') || key === 'as_of'));
}

function computeMacroMetrics(rows: CsvRow[]): AlphaSageMetric[] {
  const closes = rows.map((row) => numberOf(row.index_close ?? row.close ?? row.ma20)).filter((value): value is number => value !== null);
  const ma20 = rows.map((row) => numberOf(row.ma20)).filter((value): value is number => value !== null);
  const rates = rows.map((row) => numberOf(row.rate)).filter((value): value is number => value !== null);
  const cpi = rows.map((row) => numberOf(row.cpi)).filter((value): value is number => value !== null);
  const ppi = rows.map((row) => numberOf(row.ppi)).filter((value): value is number => value !== null);
  const northbound = rows.map((row) => numberOf(row.northbound)).filter((value): value is number => value !== null);

  return [
    makeMetric('macro_rate_direction', '利率方向', 'macro', '最新利率 - 上一期利率', rates.length, 2, () => {
      const current = last(rates)!;
      const previous = rates[rates.length - 2];
      const delta = current - previous;
      return {
        signal: clampSignal(-delta * 0.25),
        value: delta,
        unit: 'rate delta',
        evidence: `rate ${previous} -> ${current}`,
      };
    }, '需要 macro.csv 提供 rate 列且至少 2 期'),
    makeMetric('macro_cpi_trend', 'CPI 趋势', 'macro', '最新 CPI - 上一期 CPI', cpi.length, 2, () => {
      const current = last(cpi)!;
      const previous = cpi[cpi.length - 2];
      const delta = current - previous;
      return {
        signal: clampSignal(-delta * 0.2),
        value: current,
        unit: 'CPI',
        evidence: `CPI ${previous} -> ${current}`,
      };
    }, '需要 macro.csv 提供 cpi 列且至少 2 期'),
    makeMetric('macro_ppi_cpi_scissors', 'PPI-CPI 剪刀差', 'macro', '最新 PPI - CPI', Math.min(ppi.length, cpi.length), 1, () => {
      const ppiValue = last(ppi)!;
      const cpiValue = last(cpi)!;
      const scissors = ppiValue - cpiValue;
      return {
        signal: clampSignal(scissors * 0.1),
        value: scissors,
        unit: 'scissors',
        evidence: `PPI=${ppiValue}, CPI=${cpiValue}`,
      };
    }, '需要 macro.csv 同时提供 ppi 与 cpi 列'),
    makeMetric('macro_market_ma20', '大盘 MA20 状态', 'macro', 'index_close 对比 ma20', Math.min(closes.length, ma20.length), 1, () => {
      const close = last(closes)!;
      const ma = last(ma20)!;
      const gap = (close - ma) / ma;
      return {
        signal: clampSignal(gap * 6),
        value: gap,
        unit: 'gap',
        evidence: `close=${close}, MA20=${ma}`,
      };
    }, '需要 macro.csv 同时提供 index_close/close 与 ma20 列'),
    makeMetric('macro_northbound_flow', '北向资金方向', 'macro', '最新北向净额 - 上一期净额', northbound.length, 2, () => {
      const current = last(northbound)!;
      const previous = northbound[northbound.length - 2];
      const delta = current - previous;
      return {
        signal: clampSignal(delta * 0.2),
        value: current,
        unit: 'flow',
        evidence: `northbound ${previous} -> ${current}`,
      };
    }, '需要 macro.csv 提供 northbound 列且至少 2 期'),
  ];
}

function computeIndustryMetrics(rows: CsvRow[]): AlphaSageMetric[] {
  const industryClose = rows.map((row) => numberOf(row.close ?? row.industry_close)).filter((value): value is number => value !== null);
  const benchmarkClose = rows.map((row) => numberOf(row.benchmark_close)).filter((value): value is number => value !== null);
  const netInflow = rows.map((row) => numberOf(row.net_inflow)).filter((value): value is number => value !== null);
  const valuation = rows.map((row) => numberOf(row.valuation_percentile)).filter((value): value is number => value !== null);
  const samples = rows.length;

  return [
    makeMetric('industry_relative_strength', '行业相对强弱', 'industry', '60 期行业收益 - 基准收益', Math.min(industryClose.length, benchmarkClose.length), 21, () => {
      const industryReturn = returnOver(industryClose, 60);
      const benchmarkReturn = returnOver(benchmarkClose, 60);
      if (industryReturn === null || benchmarkReturn === null) return null;
      const excess = industryReturn - benchmarkReturn;
      return {
        signal: clampSignal(excess * 4),
        value: excess,
        unit: 'excess return',
        evidence: `industry=${(industryReturn * 100).toFixed(2)}%, benchmark=${(benchmarkReturn * 100).toFixed(2)}%`,
      };
    }, '需要 industry.csv 同时提供 close 与 benchmark_close 列'),
    makeMetric('industry_momentum', '行业动量', 'industry', '20 期行业指数收益率', industryClose.length, 21, () => {
      const momentum = returnOver(industryClose, 20);
      if (momentum === null) return null;
      return {
        signal: clampSignal(momentum * 5),
        value: momentum,
        unit: 'return',
        evidence: `20期收益率=${(momentum * 100).toFixed(2)}%`,
      };
    }, '需要 industry.csv 提供 close 列且至少 21 期'),
    makeMetric('industry_capital_flow', '行业资金流', 'industry', '最近 20 期净流入求和', netInflow.length, 20, () => {
      const recent = netInflow.slice(-20);
      const sum = recent.reduce((sum, value) => sum + value, 0);
      return { signal: clampSignal(sum > 0 ? 0.7 : -0.7), value: sum, unit: 'flow', evidence: `sum=${sum.toFixed(2)}` };
    }, '需要 industry.csv 提供 net_inflow 列且至少 20 期'),
    makeMetric('industry_crowding', '行业拥挤度', 'industry', '最近 20 期净流入为正占比', netInflow.length, 20, () => {
      const recent = netInflow.slice(-20);
      const positiveRatio = recent.filter((value) => value > 0).length / recent.length;
      const signal = positiveRatio >= 0.9 ? -0.45 : positiveRatio >= 0.75 ? -0.2 : positiveRatio >= 0.55 ? 0.2 : -0.1;
      return { signal, value: positiveRatio, unit: 'positive ratio', evidence: `positiveRatio=${positiveRatio.toFixed(2)}` };
    }, '需要 industry.csv 提供 net_inflow 列且至少 20 期'),
    makeMetric('industry_valuation_percentile', '行业估值分位', 'industry', '最新估值分位', valuation.length, 1, () => {
      const value = last(valuation)!;
      return { signal: value < 30 ? 0.8 : value > 70 ? -0.7 : (50 - value) / 50, value, unit: 'percentile', evidence: `latest=${value.toFixed(2)}` };
    }, '需要 industry.csv 提供 valuation_percentile 列'),
    makeMetric('industry_time_guard', '行业时间口径', 'industry', '检查是否包含 date/as_of 时间键', hasDateColumn(rows) ? samples : 0, 1, () => {
      return { signal: 0, value: samples, unit: 'rows', evidence: '时间键存在，可执行 as-of 对齐' };
    }, '未识别到 date/as_of 时间键'),
  ];
}

function computeFundamentalMetrics(rows: CsvRow[]): AlphaSageMetric[] {
  const roe = rows.map((row) => numberOf(row.roe)).filter((value): value is number => value !== null);
  const growth = rows
    .map((row) => numberOf(row.earnings_growth ?? row.revenue_growth ?? row.net_profit_growth))
    .filter((value): value is number => value !== null);
  const grossMargin = rows.map((row) => numberOf(row.gross_margin)).filter((value): value is number => value !== null);
  const operatingCashflow = rows.map((row) => numberOf(row.operating_cashflow)).filter((value): value is number => value !== null);
  const netProfit = rows.map((row) => numberOf(row.net_profit)).filter((value): value is number => value !== null);
  const receivables = rows.map((row) => numberOf(row.receivables)).filter((value): value is number => value !== null);
  const pe = rows.map((row) => numberOf(row.pe)).filter((value): value is number => value !== null);

  return [
    makeMetric('fundamental_roe_trend', 'ROE 趋势', 'fundamental', '最新 ROE 与近 4 期均值差', roe.length, 4, () => {
      const current = last(roe)!;
      const recent = roe.slice(-4);
      const mean = recent.reduce((sum, value) => sum + value, 0) / recent.length;
      const delta = current - mean;
      return {
        signal: clampSignal(delta / Math.max(1, Math.abs(mean))),
        value: current,
        unit: 'ROE',
        evidence: `current=${current.toFixed(2)}, mean4=${mean.toFixed(2)}`,
      };
    }, '需要 fundamental.csv 提供 roe 列且至少 4 期'),
    makeMetric('fundamental_earnings_growth', '盈利增长', 'fundamental', '最新 earnings_growth / revenue_growth', growth.length, 1, () => {
      const value = last(growth)!;
      return { signal: clampSignal(value / 40), value, unit: 'growth%', evidence: `latest=${value.toFixed(2)}` };
    }, '需要 fundamental.csv 提供 earnings_growth/revenue_growth 列'),
    makeMetric('fundamental_gross_margin_trend', '毛利率趋势', 'fundamental', '最新毛利率与近 4 期均值差', grossMargin.length, 4, () => {
      const current = last(grossMargin)!;
      const recent = grossMargin.slice(-4);
      const mean = recent.reduce((sum, value) => sum + value, 0) / recent.length;
      const delta = current - mean;
      return {
        signal: clampSignal(delta / Math.max(1, Math.abs(mean))),
        value: current,
        unit: 'gross margin',
        evidence: `current=${current.toFixed(2)}, mean4=${mean.toFixed(2)}`,
      };
    }, '需要 fundamental.csv 提供 gross_margin 列且至少 4 期'),
    makeMetric('fundamental_cashflow_quality', '现金流质量', 'fundamental', '经营现金流 / 净利润', Math.min(operatingCashflow.length, netProfit.length), 1, () => {
      const cashflow = last(operatingCashflow)!;
      const profit = last(netProfit)!;
      const ratio = profit === 0 ? null : cashflow / profit;
      if (ratio === null) return null;
      return { signal: clampSignal((ratio - 0.8) * 0.8), value: ratio, unit: 'ratio', evidence: `cashflow=${cashflow.toFixed(2)}, profit=${profit.toFixed(2)}` };
    }, '需要 fundamental.csv 同时提供 operating_cashflow 与 net_profit 列'),
    makeMetric('fundamental_receivable_risk', '应收风险', 'fundamental', '应收账款变化对比净利润变化', Math.min(receivables.length, netProfit.length), 2, () => {
      const receivableDelta = last(receivables)! - receivables[receivables.length - 2];
      const profitDelta = last(netProfit)! - netProfit[netProfit.length - 2];
      const risk = receivableDelta > 0 && profitDelta <= 0;
      return { signal: risk ? -0.7 : 0.15, value: receivableDelta, unit: 'delta', evidence: `receivableDelta=${receivableDelta.toFixed(2)}, profitDelta=${profitDelta.toFixed(2)}` };
    }, '需要 fundamental.csv 同时提供 receivables 与 net_profit 列且至少 2 期'),
    makeMetric('fundamental_valuation', '基本面估值', 'fundamental', '最新 PE', pe.length, 1, () => {
      const value = last(pe)!;
      return { signal: value < 15 ? 0.7 : value > 45 ? -0.6 : (30 - value) / 30, value, unit: 'PE', evidence: `latest=${value.toFixed(2)}` };
    }, '需要 fundamental.csv 提供 pe 列'),
  ];
}

function computeTechnicalMetrics(rows: CsvRow[]): AlphaSageMetric[] {
  const closes = rows.map((row) => numberOf(row.close)).filter((value): value is number => value !== null);
  const volumes = rows.map((row) => numberOf(row.volume)).filter((value): value is number => value !== null);
  const samples = closes.length;
  const price = last(closes);
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const macd = macdHistogram(closes);
  const rsiValue = rsi(closes, 14);
  const percentB = bollingerPosition(closes, 20);
  const volumeMean20 = sma(volumes, 20);

  return [
    makeMetric('technical_ma_trend', '均线趋势', 'technical', 'close 对比 MA20/MA50', samples, 50, () => {
      if (price === undefined || ma20 === null || ma50 === null) return null;
      let signal = -0.25;
      if (price > ma20 && ma20 > ma50) signal = 0.85;
      else if (price > ma20 && ma20 < ma50) signal = 0.25;
      else if (price < ma20 && ma20 < ma50) signal = -0.85;
      return { signal, value: price, unit: 'close', evidence: `close=${price}, MA20=${ma20.toFixed(2)}, MA50=${ma50.toFixed(2)}` };
    }, '需要 ohlcv.csv 提供 close 列且至少 50 期'),
    makeMetric('technical_macd', 'MACD 信号', 'technical', 'EMA12-EMA26 与 DEA9 差值', samples, 35, () => {
      if (macd === null) return null;
      return { signal: clampSignal(macd / Math.max(1e-8, Math.abs(price ?? 1) * 0.02)), value: macd, unit: 'histogram', evidence: `MACD histogram=${macd.toFixed(6)}` };
    }, '需要 ohlcv.csv 提供 close 列且至少 35 期'),
    makeMetric('technical_rsi', 'RSI 极值', 'technical', 'Wilder RSI14', samples, 15, () => {
      if (rsiValue === null) return null;
      return { signal: rsiValue > 70 ? -0.8 : rsiValue < 30 ? 0.8 : (rsiValue - 50) / 50, value: rsiValue, unit: 'RSI', evidence: `RSI14=${rsiValue.toFixed(2)}` };
    }, '需要 ohlcv.csv 提供 close 列且至少 15 期'),
    makeMetric('technical_bollinger', '布林带位置', 'technical', '(close-下轨)/(上轨-下轨)', samples, 20, () => {
      if (percentB === null) return null;
      return { signal: percentB > 1 ? -0.7 : percentB < 0 ? 0.7 : (percentB - 0.5) * 1.2, value: percentB, unit: '%B', evidence: `percentB=${percentB.toFixed(4)}` };
    }, '需要 ohlcv.csv 提供 close 列且至少 20 期'),
    makeMetric('technical_volume', '量能结构', 'technical', '最新 volume / MA20(volume)', Math.min(closes.length, volumes.length), 21, () => {
      const currentVolume = last(volumes)!;
      if (!volumeMean20) return null;
      const ratio = currentVolume / volumeMean20;
      return { signal: clampSignal((ratio - 1) * 0.45), value: ratio, unit: 'x', evidence: `volume=${currentVolume}, MA20=${volumeMean20.toFixed(2)}` };
    }, '需要 ohlcv.csv 同时提供 close 与 volume 列且至少 21 期'),
  ];
}

function computeSentimentMetrics(rows: CsvRow[], rawText: string): AlphaSageMetric[] {
  const bullish = rows.map((row) => numberOf(row.bullish_ratio)).filter((value): value is number => value !== null);
  const bearish = rows.map((row) => numberOf(row.bearish_ratio)).filter((value): value is number => value !== null);
  const limitUp = rows.map((row) => numberOf(row.limit_up)).filter((value): value is number => value !== null);
  const limitDown = rows.map((row) => numberOf(row.limit_down)).filter((value): value is number => value !== null);
  if (!bullish.length) {
    const match = rawText.match(/(\d+(?:\.\d+)?)\s*%/);
    if (match) bullish.push(Number(match[1]));
  }
  return [
    makeMetric('sentiment_bullish_ratio', '多头情绪占比', 'sentiment', '最新 bullish_ratio', bullish.length, 1, () => {
      const value = last(bullish)! / (last(bullish)! > 1 ? 100 : 1);
      const herd = value >= 0.9;
      return { signal: herd ? -0.45 : clampSignal((value - 0.5) * 2), value, unit: 'ratio', evidence: herd ? `bullish=${value.toFixed(2)}，触发羊群效应降权` : `bullish=${value.toFixed(2)}` };
    }, '需要 sentiment.csv 提供 bullish_ratio 列，或在文本中包含百分比'),
    makeMetric('sentiment_limit_structure', '涨跌停结构', 'sentiment', 'limit_up / (limit_up + limit_down)', Math.min(limitUp.length, limitDown.length), 1, () => {
      const up = last(limitUp)!;
      const down = last(limitDown)!;
      if (up + down === 0) return null;
      const ratio = up / (up + down);
      return { signal: clampSignal((ratio - 0.5) * 1.6), value: ratio, unit: 'ratio', evidence: `up=${up}, down=${down}` };
    }, '需要 sentiment.csv 同时提供 limit_up 与 limit_down 列'),
    makeMetric('sentiment_bearish_check', '空头情绪核查', 'sentiment', '最新 bearish_ratio', bearish.length, 1, () => {
      const value = last(bearish)! / (last(bearish)! > 1 ? 100 : 1);
      return { signal: clampSignal((0.5 - value) * 2), value, unit: 'ratio', evidence: `bearish=${value.toFixed(2)}` };
    }, '需要 sentiment.csv 提供 bearish_ratio 列'),
  ];
}

function agent(positions: PositionMap, positionId: string): { name: string; accent: string; emoji: string } {
  return positions.get(positionId) ?? { name: '未加载智能体', accent: '#94a3b8', emoji: '🤖' };
}

function report(
  positions: PositionMap,
  positionId: string,
  roleName: string,
  domain: AlphaSageDomain,
  decision: AlphaSageAgentReport['decision'],
  conclusion: string,
  evidence: string[],
  questions: string[] = [],
): AlphaSageAgentReport {
  const item = agent(positions, positionId);
  return {
    agentId: positionId,
    agentName: item.name,
    roleName,
    domain,
    decision,
    conclusion,
    evidence,
    questions,
  };
}

function domainScores(metrics: AlphaSageMetric[]): Record<AlphaSageMetric['layer'], DomainScore> {
  const result = {} as Record<AlphaSageMetric['layer'], DomainScore>;
  (Object.keys(LAYER_WEIGHTS) as AlphaSageMetric['layer'][]).forEach((layer) => {
    const list = metrics.filter((metric) => metric.layer === layer);
    const ok = list.filter((metric) => metric.status === 'OK');
    result[layer] = {
      score: ok.length ? ok.reduce((sum, metric) => sum + metric.signal, 0) / ok.length : 0,
      okCount: ok.length,
      totalCount: list.length,
    };
  });
  return result;
}

function buildDecision(
  input: AlphaSageInput,
  metrics: AlphaSageMetric[],
  scores: Record<AlphaSageMetric['layer'], DomainScore>,
  veto: boolean,
): AlphaSageDecision {
  const missingLayers = (Object.keys(LAYER_WEIGHTS) as AlphaSageMetric['layer'][]).filter(
    (layer) => scores[layer].okCount === 0,
  );
  const weightedScore = (Object.keys(LAYER_WEIGHTS) as AlphaSageMetric['layer'][]).reduce(
    (sum, layer) => sum + LAYER_WEIGHTS[layer] * scores[layer].score,
    0,
  );
  const warnings: string[] = [];
  const reasonChain: string[] = [
    `显性权重：宏观30% / 行业25% / 基本面20% / 技术15% / 情绪10%。`,
    ...((Object.keys(LAYER_WEIGHTS) as AlphaSageMetric['layer'][]).map(
      (layer) => `${LAYER_LABELS[layer]}：${scores[layer].okCount}/${scores[layer].totalCount} 个指标有效，层内信号 ${scores[layer].score.toFixed(3)}。`,
    )),
  ];

  const stopLoss = input.stopLoss;
  const maxDrawdown = input.maxDrawdown;
  if (stopLoss === null) warnings.push('缺少止损计划，保守风控经理将一票否决。');
  if (maxDrawdown === null) warnings.push('缺少最大回撤约束，无法完成完整风控确认。');
  if (missingLayers.length) warnings.push(`缺失层：${missingLayers.map((layer) => LAYER_LABELS[layer]).join('、')}。`);

  if (veto || missingLayers.length) {
    return {
      direction: '数据不足，暂不决策',
      positionSize: 0,
      confidence: 0,
      score: Number(weightedScore.toFixed(3)),
      stopLoss: stopLoss ?? undefined,
      maxDrawdown: maxDrawdown ?? undefined,
      warnings,
      reasonChain: [
        ...reasonChain,
        'R2 数据不足守卫触发：固定返回「数据不足，暂不决策」，不用叙事填补空白。',
      ],
      veto,
    };
  }

  const riskProfile = input.riskProfile;
  const maxPosition = Math.max(0, Math.min(100, input.maxPosition));
  const aggressiveSize = Math.min(maxPosition, Math.max(0, weightedScore * 45));
  const balancedSize = Math.min(maxPosition * 0.7, Math.max(0, weightedScore * 28));
  const conservativeSize = Math.min(maxPosition * 0.4, Math.max(0, weightedScore * 14));
  const baseSize = riskProfile === 'aggressive' ? aggressiveSize : riskProfile === 'balanced' ? balancedSize : conservativeSize;
  const direction = weightedScore > 0.18 ? '买入/加仓' : weightedScore < -0.18 ? '回避/减仓' : '持有/观望';
  const positionSize = direction === '回避/减仓' ? 0 : Math.round(baseSize * 10) / 10;
  const negativeSignals = metrics.filter((metric) => metric.status === 'OK' && metric.signal <= -0.4).map((metric) => metric.name);
  const positiveSignals = metrics.filter((metric) => metric.status === 'OK' && metric.signal >= 0.4).map((metric) => metric.name);

  reasonChain.push(
    `纯代码综合信号 ${weightedScore.toFixed(3)}。`,
    positiveSignals.length ? `主要正向：${positiveSignals.join('、')}。` : '暂无强正向信号。',
    negativeSignals.length ? `主要风险：${negativeSignals.join('、')}。` : '暂无强负向信号。',
    `用户约束：最大仓位 ${maxPosition}%，风险偏好 ${riskProfile === 'aggressive' ? '激进' : riskProfile === 'balanced' ? '均衡' : '保守'}。`,
    stopLoss !== null ? `止损计划：-${stopLoss}%。` : '',
    maxDrawdown !== null ? `最大回撤约束：-${maxDrawdown}%。` : '',
  );

  return {
    direction,
    positionSize,
    confidence: Number(Math.max(0.2, Math.min(0.94, 0.62 + Math.abs(weightedScore) * 0.5)).toFixed(2)),
    score: Number(weightedScore.toFixed(3)),
    stopLoss: stopLoss ?? undefined,
    maxDrawdown: maxDrawdown ?? undefined,
    warnings,
    reasonChain: reasonChain.filter(Boolean),
    veto,
  };
}

function extractDataCounts(input: AlphaSageInput) {
  const macroRows = parseCsv(input.macro);
  const industryRows = parseCsv(input.industry);
  const fundamentalRows = parseCsv(input.fundamental);
  const ohlcvRows = parseCsv(input.ohlcv);
  const sentimentRows = parseCsv(input.sentiment);
  return {
    macroRows,
    industryRows,
    fundamentalRows,
    ohlcvRows,
    sentimentRows,
  };
}

export function createAlphaSageInput(): AlphaSageInput {
  return {
    target: '',
    horizon: '中线',
    riskProfile: 'balanced',
    maxPosition: 20,
    stopLoss: 8,
    maxDrawdown: 15,
    note: '',
    macro: '',
    industry: '',
    fundamental: '',
    ohlcv: '',
    sentiment: '',
  };
}

export function alphaSageSampleInput(): AlphaSageInput {
  const dates = Array.from({ length: 70 }, (_, index) => {
    const date = new Date(2026, 5, 1 + index);
    return date.toISOString().slice(0, 10);
  });
  const macroRows = dates.slice(-24).map((date, index) => {
    const close = 3900 + index * 8;
    return [date, 3.1 - index * 0.01, 3.5 - index * 0.02, 3.2 - index * 0.01, close, close * 0.985, 120 + index * 8].join(',');
  });
  const industryRows = dates.slice(-40).map((date, index) => {
    const close = 2200 + index * 9;
    const benchmark = 3900 + index * 7;
    return [date, close, benchmark, 250000 + index * 9000, 42 + index * 0.2].join(',');
  });
  const fundamentalRows = Array.from({ length: 8 }, (_, index) => {
    const quarter = `202${4 + Math.floor(index / 4)}Q${(index % 4) + 1}`;
    return [quarter, 14 + index * 0.2, 22 + index * 0.4, 42 + index * 0.1, 12 + index, 10 + index * 0.8, 8 + index, 24 - index * 0.3].join(',');
  });
  const ohlcvRows = dates.map((date, index) => {
    const close = 100 + Math.sin(index / 6) * 6 + index * 0.18;
    const open = close - 0.8;
    const high = close + 1.6;
    const low = close - 1.8;
    const volume = 850000 + Math.round(Math.abs(Math.sin(index / 3)) * 250000) + index * 1500;
    return [date, open.toFixed(2), high.toFixed(2), low.toFixed(2), close.toFixed(2), volume].join(',');
  });
  return {
    target: '示例研究标的',
    horizon: '中线',
    riskProfile: 'balanced',
    maxPosition: 20,
    stopLoss: 8,
    maxDrawdown: 15,
    note: '示例数据，用于验证流水线和界面；不能视为真实投资建议。',
    macro: 'date,cpi,ppi,rate,index_close,ma20,northbound\n' + macroRows.join('\n'),
    industry: 'date,close,benchmark_close,net_inflow,valuation_percentile\n' + industryRows.join('\n'),
    fundamental: 'quarter,roe,earnings_growth,gross_margin,operating_cashflow,net_profit,receivables,pe\n' + fundamentalRows.join('\n'),
    ohlcv: 'date,open,high,low,close,volume\n' + ohlcvRows.join('\n'),
    sentiment: 'date,bullish_ratio,bearish_ratio,limit_up,limit_down\n2026-09-15,78,22,48,12',
  };
}

export function runAlphaSagePipeline(input: AlphaSageInput, state: AppState): AlphaSageRun {
  const createdAt = new Date().toISOString();
  const positionMap: PositionMap = new Map(
    [...state.positions, ...ALPHASAGE_POSITIONS].map((position) => [
      position.id,
      { name: position.name, accent: position.accent, emoji: position.avatarEmoji },
    ]),
  );
  state.personas.forEach((persona) => {
    const position = positionMap.get(persona.positionId);
    if (position) positionMap.set(persona.positionId, { ...position, name: persona.name });
  });

  const data = extractDataCounts(input);
  const macroMetrics = computeMacroMetrics(data.macroRows);
  const industryMetrics = computeIndustryMetrics(data.industryRows);
  const fundamentalMetrics = computeFundamentalMetrics(data.fundamentalRows);
  const technicalMetrics = computeTechnicalMetrics(data.ohlcvRows);
  const sentimentMetrics = computeSentimentMetrics(data.sentimentRows, input.sentiment);
  const metrics = [...macroMetrics, ...industryMetrics, ...fundamentalMetrics, ...technicalMetrics, ...sentimentMetrics];
  const scores = domainScores(metrics);

  const reports: AlphaSageAgentReport[] = [];
  const audit: AlphaSageAuditEvent[] = [];

  // ── 域一：数据感知与清洁 ─────────────────────────────
  const availableLayers = [
    data.macroRows.length && '宏观',
    data.industryRows.length && '行业',
    data.fundamentalRows.length && '基本面',
    data.ohlcvRows.length && '行情',
    data.sentimentRows.length && '情绪',
  ].filter(Boolean) as string[];
  reports.push(
    report(
      positionMap,
      'pos-alpha-data-gatherer',
      '信息采集官',
      'data',
      availableLayers.length >= 5 ? 'PASS' : 'WARN',
      `本次收到 ${availableLayers.length}/5 层数据：${availableLayers.join('、') || '无'}。`,
      [
        `宏观行数：${data.macroRows.length}`,
        `行业行数：${data.industryRows.length}`,
        `基本面行数：${data.fundamentalRows.length}`,
        `行情行数：${data.ohlcvRows.length}`,
        `情绪行数：${data.sentimentRows.length}`,
      ],
      ['数据来源和时间戳是什么？', '是否存在 as-of 对齐？'],
    ),
  );

  const malformed = [
    ...data.macroRows.filter(hasSuspectValue),
    ...data.industryRows.filter(hasSuspectValue),
    ...data.fundamentalRows.filter(hasSuspectValue),
    ...data.ohlcvRows.filter(hasSuspectValue),
    ...data.sentimentRows.filter(hasSuspectValue),
  ].length;
  reports.push(
    report(
      positionMap,
      'pos-alpha-fact-guard',
      '事实核查官',
      'data',
      malformed ? 'WARN' : availableLayers.length >= 5 ? 'PASS' : 'INSUFFICIENT_DATA',
      malformed
        ? `发现 ${malformed} 行疑似不可解析数据，未参与计算。`
        : availableLayers.length >= 5
          ? '五层数据通过基本清洗检查，金融算术全部交给纯代码层。'
          : '数据层不完整，缺失层不得进入最终决策。',
      ['时间键检查：' + [data.macroRows, data.industryRows, data.fundamentalRows, data.ohlcvRows, data.sentimentRows].map(hasDateColumn).join(' / ')],
      ['是否有同码不同义列？', '财报与行情的时间口径是否对齐？'],
    ),
  );

  reports.push(
    report(
      positionMap,
      'pos-alpha-auditor',
      '审计追踪官',
      'data',
      'PASS',
      '输入、指标、决策与风控结论将全部追加到审计台账，不覆盖历史。',
      [`本次产出 ${metrics.length} 个指标；有效 ${metrics.filter((metric) => metric.status === 'OK').length} 个。`],
      ['用户风控约束是否完整保留？'],
    ),
  );

  // ── 域二：独立分析 ──────────────────────────────────
  const layerAgents: { positionId: string; roleName: string; layer: AlphaSageMetric['layer'] }[] = [
    { positionId: 'pos-alpha-macro', roleName: '宏观分析师', layer: 'macro' },
    { positionId: 'pos-alpha-sector', roleName: '行业景气分析师', layer: 'industry' },
    { positionId: 'pos-alpha-fundamental', roleName: '基本面分析师', layer: 'fundamental' },
    { positionId: 'pos-alpha-technical', roleName: '技术量化分析师', layer: 'technical' },
    { positionId: 'pos-alpha-sentiment', roleName: '情绪分析师', layer: 'sentiment' },
  ];
  for (const item of layerAgents) {
    const layerMetrics = metrics.filter((metric) => metric.layer === item.layer);
    const ok = layerMetrics.filter((metric) => metric.status === 'OK');
    const score = ok.length ? ok.reduce((sum, metric) => sum + metric.signal, 0) / ok.length : 0;
    const status = ok.length ? score > 0.15 ? 'PASS' : score < -0.15 ? 'WARN' : 'PASS' : 'INSUFFICIENT_DATA';
    const evidence = ok.map((metric) => `${metric.name}=${metric.value ?? metric.signal}（${metric.evidence ?? metric.formula}）`).slice(0, 5);
    reports.push(
      report(
        positionMap,
        item.positionId,
        item.roleName,
        'analysis',
        status,
        ok.length
          ? `${LAYER_LABELS[item.layer]}层有效指标 ${ok.length}/${layerMetrics.length}，层内信号 ${score.toFixed(3)}。`
          : `${LAYER_LABELS[item.layer]}层缺少可用数据，返回 INSUFFICIENT_DATA。`,
        evidence,
        ok.length ? ['该信号在极端情景下是否仍然成立？'] : ['需要补充哪些最小数据集？'],
      ),
    );
  }

  // ── 域三：多空、偏差与决策 ────────────────────────────
  const positive = metrics.filter((metric) => metric.status === 'OK' && metric.signal >= 0.35).map((metric) => `${metric.name}(${metric.signal.toFixed(2)})`);
  const negative = metrics.filter((metric) => metric.status === 'OK' && metric.signal <= -0.35).map((metric) => `${metric.name}(${metric.signal.toFixed(2)})`);
  reports.push(
    report(
      positionMap,
      'pos-alpha-bull',
      '多头研究员',
      'debate',
      positive.length ? 'PASS' : 'WARN',
      positive.length ? `多头证据集中在 ${positive.slice(0, 4).join('、')}。` : '当前没有足够强的多头证据，不能强行看多。',
      positive.length ? positive : ['无强正向指标'],
      ['多头逻辑依赖的催化剂何时兑现？'],
    ),
  );
  reports.push(
    report(
      positionMap,
      'pos-alpha-bear',
      '空头研究员',
      'debate',
      negative.length ? 'WARN' : 'PASS',
      negative.length ? `空头攻击点包括 ${negative.slice(0, 4).join('、')}。` : '暂未发现强负向信号，但仍需检查流动性和黑天鹅。',
      negative.length ? negative : ['暂无强负向指标'],
      ['三个致命缺陷分别是什么？', '悲观情景下流动性是否仍然充足？'],
    ),
  );

  const bullishMetric = metrics.find((metric) => metric.id === 'sentiment_bullish_ratio');
  const herd = bullishMetric?.status === 'OK' && (bullishMetric.value ?? 0) >= 0.9;
  const lossAversion = /等反弹|回本再卖|死扛|不想割|舍不得/.test(input.note);
  const anchoring = /成本|持仓价|买价/.test(input.note);
  const biasDecision = lossAversion ? 'BLOCK' : herd || anchoring ? 'WARN' : 'PASS';
  reports.push(
    report(
      positionMap,
      'pos-alpha-bias',
      '认知偏差审计师',
      'debate',
      biasDecision,
      lossAversion
        ? '检测到损失厌恶叙事，触发冷却并否决当前执行。'
        : herd
          ? '多头情绪极端一致，已对情绪层降权并提示羊群效应。'
          : anchoring
            ? '备注包含成本锚定词，需要改用当前机会成本重估。'
            : '未检测到明显损失厌恶、羊群效应或成本锚定。',
      [
        lossAversion ? '触发词：等反弹 / 回本 / 死扛' : '未发现损失厌恶触发词',
        herd ? '多头占比超过 90%' : '多头占比未达极端一致阈值',
      ],
      ['是否把“回本”当成了决策目标？'],
    ),
  );

  const missingLayers = (Object.keys(LAYER_WEIGHTS) as AlphaSageMetric['layer'][]).filter((layer) => scores[layer].okCount === 0);
  const missingLayersText = missingLayers.map((layer) => LAYER_LABELS[layer]).join('、') || '无';
  reports.push(
    report(
      positionMap,
      'pos-alpha-manager',
      '研究经理',
      'debate',
      missingLayers.length ? 'INSUFFICIENT_DATA' : 'PASS',
      missingLayers.length
        ? `${missingLayersText}层缺失，暂不输出投资方向。`
        : '多空证据已收敛到显性权重模型，最终结论见决策卡。',
      [`宏观 ${scores.macro.score.toFixed(3)}；行业 ${scores.industry.score.toFixed(3)}；基本面 ${scores.fundamental.score.toFixed(3)}；技术 ${scores.technical.score.toFixed(3)}；情绪 ${scores.sentiment.score.toFixed(3)}。`],
      missingLayers.length ? ['需要补齐哪些数据层？'] : [],
    ),
  );

  reports.push(
    report(
      positionMap,
      'pos-alpha-user-proxy',
      '用户意图映射官',
      'debate',
      input.maxPosition > 0 && input.stopLoss !== null ? 'PASS' : 'WARN',
      `已锁定风险偏好 ${input.riskProfile === 'aggressive' ? '激进' : input.riskProfile === 'balanced' ? '均衡' : '保守'}，最大仓位 ${input.maxPosition}%。`,
      [`止损：${input.stopLoss === null ? '未提供' : `-${input.stopLoss}%`}`, `最大回撤：${input.maxDrawdown === null ? '未提供' : `-${input.maxDrawdown}%`}`],
      ['该约束是否来自用户明确确认？'],
    ),
  );

  // ── 域四：风控与治理 ────────────────────────────────
  const noStopLoss = input.stopLoss === null;
  const conservativeVeto = noStopLoss || lossAversion || missingLayers.length > 0;
  const conservativeReport = report(
    positionMap,
    'pos-alpha-risk-conservative',
    '保守风控经理',
    'risk',
    conservativeVeto ? 'BLOCK' : 'PASS',
    conservativeVeto
      ? noStopLoss
        ? '缺少止损计划，行使一票否决。'
        : lossAversion
          ? '损失厌恶触发冷却，行使一票否决。'
          : '数据层缺失，拒绝进入执行。'
      : `最大回撤约束已确认：${input.maxDrawdown === null ? '未提供' : `-${input.maxDrawdown}%`}。`,
    [noStopLoss ? 'stop_loss=null' : `stop_loss=-${input.stopLoss}%`],
    [],
  );
  reports.push(
    report(
      positionMap,
      'pos-alpha-risk-aggressive',
      '激进风控经理',
      'risk',
      'PASS',
      '给出进攻性仓位上限，但必须受用户最大仓位约束。',
      [`进攻性建议：${Math.round(Math.min(input.maxPosition, Math.max(0, weightedTotal(scores)) * 45))}%`],
    ),
  );
  reports.push(
    report(
      positionMap,
      'pos-alpha-risk-balanced',
      '中性风控经理',
      'risk',
      'PASS',
      '建议采用分批与均衡仓位，避免一次性押注。',
      [`中性建议：${Math.round(Math.min(input.maxPosition * 0.7, Math.max(0, weightedTotal(scores)) * 28))}%`],
    ),
  );
  reports.push(conservativeReport);
  reports.push(
    report(
      positionMap,
      'pos-alpha-governance',
      '集群治理与执行官',
      'risk',
      conservativeVeto ? 'BLOCK' : 'PASS',
      conservativeVeto
        ? '参数或风控约束不完整，最终拒绝生成执行建议。'
        : '最终参数完整，仅输出研究结论，不直接接入交易。',
      [`决策状态：${missingLayers.length ? 'INSUFFICIENT_DATA' : 'OK'}`],
      ['是否需要人工确认后再执行？'],
    ),
  );

  const decision = buildDecision(input, metrics, scores, conservativeVeto);
  audit.push(
    {
      at: createdAt,
      actor: agent(positionMap, 'pos-alpha-data-gatherer').name,
      action: '数据登记',
      detail: `收到 ${availableLayers.length}/5 层数据，共 ${data.macroRows.length + data.industryRows.length + data.fundamentalRows.length + data.ohlcvRows.length + data.sentimentRows.length} 行。`,
    },
    {
      at: createdAt,
      actor: agent(positionMap, 'pos-alpha-technical').name,
      action: '纯代码计算',
      detail: `产出 ${metrics.length} 个指标，有效 ${metrics.filter((metric) => metric.status === 'OK').length} 个；LLM 未参与算术。`,
    },
    {
      at: new Date().toISOString(),
      actor: agent(positionMap, 'pos-alpha-bias').name,
      action: lossAversion ? '认知偏差熔断' : '偏差审计',
      detail: lossAversion ? '检测到损失厌恶叙事并触发否决。' : '未检测到强制熔断级偏差。',
    },
    {
      at: new Date().toISOString(),
      actor: agent(positionMap, 'pos-alpha-risk-conservative').name,
      action: conservativeVeto ? '一票否决' : '风控确认',
      detail: decision.direction,
    },
  );

  return {
    id: `alpha-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    target: input.target.trim() || '未命名标的',
    horizon: input.horizon,
    riskProfile: input.riskProfile,
    createdAt,
    updatedAt: new Date().toISOString(),
    status: decision.direction === '数据不足，暂不决策' ? 'INSUFFICIENT_DATA' : 'OK',
    input,
    metrics,
    reports,
    decision,
    audit,
  };
}

function weightedTotal(scores: Record<AlphaSageMetric['layer'], DomainScore>): number {
  return (Object.keys(LAYER_WEIGHTS) as AlphaSageMetric['layer'][]).reduce(
    (sum, layer) => sum + LAYER_WEIGHTS[layer] * scores[layer].score,
    0,
  );
}

function hasSuspectValue(row: CsvRow): boolean {
  return Object.values(row).some(
    (value) =>
      Boolean(value) &&
      !/^[\d]{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(value) &&
      !/^\d{4}Q[1-4]$/i.test(value) &&
      numberOf(value) === null &&
      !/[a-zA-Z\u4e00-\u9fa5]/.test(value),
  );
}
