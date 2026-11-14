// Token radar model radar-2: implied value, board selection and farm steps.
// Node 22, standard library only. No network, no randomness, no wall-clock
// output: every number derives from the snapshot passed in.

export const MODEL_VERSION = 'radar-2';
export const BASE_MULTIPLE = 0.25;
export const BOARD_SIZE = 198;
export const LIVE_SIZE = 24;
export const SET_ASIDE_SIZE = 24;
export const MAX_MATURITY_DAYS = 1460;
export const DEFAULT_AGE_DAYS = 365;

export interface ProtocolInput {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface SnapshotInput {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolInput[];
  watchlist: string[];
}

export interface ModelBreakdown {
  base_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token' | 'live';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
  set_aside_reason?: string;
}

export interface BoardResult {
  rows: BoardRow[];
  live: BoardRow[];
  set_aside: BoardRow[];
}

/** Clamp a 7-day change into the band the growth factor accepts. */
export function clampChange(pct: number): number {
  if (pct < -50) return -50;
  if (pct > 150) return 150;
  return pct;
}

/** Whole days from a UTC calendar date string to another one. */
export function wholeDays(fromDate: string, toDate: string): number {
  const fromMs = Date.parse(`${fromDate}T00:00:00.000Z`);
  const toMs = Date.parse(`${toDate}T00:00:00.000Z`);
  return Math.round((toMs - fromMs) / 86400000);
}

/** Growth multiplier: 1 plus the clamped 7-day change, damped to 60%. */
export function growthMultiplier(change7d: number | null): { pct: number; multiplier: number } {
  const pct = change7d === null ? 0 : clampChange(change7d);
  return { pct, multiplier: 1 + (pct / 100) * 0.6 };
}

/** Maturity multiplier: 0.55 at listing, rising to 1.00 after four years. */
export function maturityMultiplier(ageDays: number): number {
  const capped = Math.min(Math.max(ageDays, 0), MAX_MATURITY_DAYS);
  return 0.55 + (capped / MAX_MATURITY_DAYS) * 0.45;
}

/** Breadth multiplier: 2% per extra chain, capped at six extra chains. */
export function breadthMultiplier(chainCount: number): number {
  return 1 + Math.min(chainCount - 1, 6) * 0.02;
}

/** A protocol is pre-token when it has neither a market listing nor a symbol. */
export function isPreToken(p: ProtocolInput): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Score one protocol under radar-2 and return its implied value plus factors. */
export function scoreProtocol(
  p: ProtocolInput,
  asOf: string,
): { implied: number; breakdown: ModelBreakdown; ageDays: number | null } {
  const ageDays = p.listed_at === null ? null : wholeDays(p.listed_at, asOf);
  const effectiveAge = ageDays === null ? DEFAULT_AGE_DAYS : ageDays;
  const growth = growthMultiplier(p.change_7d);
  const maturity = maturityMultiplier(effectiveAge);
  const breadth = breadthMultiplier(p.chains.length);
  const raw = p.tvl_usd * BASE_MULTIPLE * growth.multiplier * maturity * breadth;
  return {
    implied: Math.round(raw),
    breakdown: {
      base_multiple: BASE_MULTIPLE,
      growth_pct: growth.pct,
      growth_multiplier: growth.multiplier,
      maturity_multiplier: maturity,
      breadth_multiplier: breadth,
      age_days: effectiveAge,
    },
    ageDays,
  };
}

// ---------------------------------------------------------------- product rule

const EXCLUDED_CATEGORIES = new Set([
  'bridge',
  'canonical bridge',
  'liquid staking',
  'liquid restaking',
  'restaked btc',
  'cex',
]);

const EXCHANGE_BRANDS = [
  'binance',
  'coinbase',
  'kraken',
  'okx',
  'bybit',
  'kucoin',
  'bitfinex',
  'gemini',
  'crypto.com',
  'huobi',
  'htx',
  'gate.io',
  'mexc',
  'bitstamp',
  'bitget',
  'bitmart',
  'okex',
  'deribit',
  'phemex',
  'coinex',
  'upbit',
  'bithumb',
  'lbank',
];

/**
 * The product rule: null when the protocol may sit on the board, otherwise
 * one English sentence saying why it is set aside.
 */
export function productRuleReason(p: ProtocolInput): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category.trim().toLowerCase())) {
    return `Category ${p.category} is excluded from the board.`;
  }
  const name = p.name;
  if (/\b(wrapped|staked|staking)\b/i.test(name)) {
    return 'Name contains a wrapped or staked asset term.';
  }
  const lowered = name.trim().toLowerCase();
  for (const brand of EXCHANGE_BRANDS) {
    if (
      lowered === brand ||
      lowered.startsWith(`${brand} `) ||
      lowered.startsWith(`${brand}-`) ||
      lowered.startsWith(`${brand}:`)
    ) {
      return 'Name starts with a centralized exchange brand.';
    }
  }
  if (/\bv\d+\s*$/i.test(name.trim())) {
    return 'Name carries a version marker.';
  }
  return null;
}

// ---------------------------------------------------------------- farm steps

type StepKind = 'lending' | 'trading' | 'yield' | 'derivatives' | 'staking' | 'generic';

function stepKindOf(category: string | null): StepKind {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('borrow')) return 'lending';
  if (c.includes('dex') || c.includes('swap') || c.includes('exchange') || c.includes('trad')) return 'trading';
  if (c.includes('yield') || c.includes('vault') || c.includes('farm')) return 'yield';
  if (c.includes('deriv') || c.includes('perpetual') || c.includes('option')) return 'derivatives';
  if (c.includes('stak') || c.includes('restak')) return 'staking';
  return 'generic';
}

function weeklyStep(kind: StepKind, name: string): string {
  switch (kind) {
    case 'lending':
      return `每周一次向 ${name} 存入 50 美元并借出不超过 30 美元的资产，保持抵押率充足，每次操作约 20 分钟，手续费控制在 3 美元以内。`;
    case 'trading':
      return `每周一次在 ${name} 用 50 美元兑换主流资产或加入流动性池，单次滑点不超过 1%，每次操作约 20 分钟，手续费控制在 3 美元以内。`;
    case 'yield':
      return `每周一次把 50 美元收益转入 ${name} 的金库复投，检查金库年化与回撤，每次操作约 20 分钟，手续费控制在 3 美元以内。`;
    case 'derivatives':
      return `每周一次在 ${name} 用 50 美元开立对冲持仓并把敞口控制在总仓位的 30% 以内，每次操作约 20 分钟，手续费控制在 3 美元以内。`;
    case 'staking':
      return `每周一次在 ${name} 追加质押 50 美元并领取已产生的质押收益，每次操作约 20 分钟，手续费控制在 3 美元以内。`;
    default:
      return `每周一次在 ${name} 存入 50 美元并完成一次常规交互，确认仓位与积分正常记录，每次操作约 20 分钟，手续费控制在 3 美元以内。`;
  }
}

/**
 * Six generic farming steps for one protocol. Each step states a dollar cost
 * and a time span, names no person, and invents no protocol-only feature.
 */
export function farmSteps(p: ProtocolInput): string[] {
  const name = p.name;
  return [
    `新建一个只用于 ${name} 的钱包，离线抄好助记词并开启硬件二次确认，先转入 5 美元做连通测试，整个准备过程约 30 分钟。`,
    `首次向 ${name} 存入 100 美元并完成一次小额交互，确认资金到账与仓位显示正常，等待约 10 分钟后再追加其余资金。`,
    weeklyStep(stepKindOf(p.category), name),
    `持有仓位至少 4 周，每 3 天检查一次价格与协议公告，另预留 10 美元作为网络手续费，避免行情波动时无法操作。`,
    `每 2 周领取一次 ${name} 的奖励或积分，领取手续费约 2 美元，操作耗时约 15 分钟，领到的奖励先持有不动。`,
    `当总锁仓量 7 天内下跌超过 20% 或奖励连续 2 周归零时，在 7 天内分批退出，每次操作约 20 分钟，每次保留 5 美元作为后续手续费。`,
  ];
}

// ---------------------------------------------------------------- board build

function byImpliedDesc(a: Scored, b: Scored): number {
  if (b.implied !== a.implied) return b.implied - a.implied;
  return a.proto.slug < b.proto.slug ? -1 : a.proto.slug > b.proto.slug ? 1 : 0;
}

function byTvlDesc(a: Scored, b: Scored): number {
  if (b.proto.tvl_usd !== a.proto.tvl_usd) return b.proto.tvl_usd - a.proto.tvl_usd;
  return a.proto.slug < b.proto.slug ? -1 : a.proto.slug > b.proto.slug ? 1 : 0;
}

interface Scored {
  proto: ProtocolInput;
  implied: number;
  breakdown: ModelBreakdown;
  ageDays: number | null;
  preToken: boolean;
  reason: string | null;
  onWatchlist: boolean;
}

function toRow(s: Scored, rank: number): BoardRow {
  const row: BoardRow = {
    rank,
    slug: s.proto.slug,
    name: s.proto.name,
    category: s.proto.category,
    chains: [...s.proto.chains],
    tvl_usd: s.proto.tvl_usd,
    change_7d: s.proto.change_7d,
    mcap_usd: s.proto.mcap_usd,
    listed_at: s.proto.listed_at,
    gecko_id: s.proto.gecko_id,
    symbol: s.proto.symbol,
    token_status: s.preToken ? 'pre-token' : 'live',
    on_watchlist: s.onWatchlist,
    age_days: s.ageDays,
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps(s.proto),
  };
  if (s.reason !== null) row.set_aside_reason = s.reason;
  return row;
}

/** Build the board, live list and set-aside list from one snapshot. */
export function buildBoard(snapshot: SnapshotInput): BoardResult {
  const watch = new Set(snapshot.watchlist);
  const scored: Scored[] = snapshot.protocols.map((proto) => {
    const scoredValue = scoreProtocol(proto, snapshot.as_of);
    return {
      proto,
      implied: scoredValue.implied,
      breakdown: scoredValue.breakdown,
      ageDays: scoredValue.ageDays,
      preToken: isPreToken(proto),
      reason: productRuleReason(proto),
      onWatchlist: watch.has(proto.slug),
    };
  });

  const eligible = scored.filter((s) => s.preToken && s.reason === null);
  const boardPool = [...eligible].sort(byImpliedDesc).slice(0, BOARD_SIZE);
  const rows = boardPool.map((s, i) => toRow(s, i + 1));

  const live = scored
    .filter((s) => !s.preToken)
    .sort(byTvlDesc)
    .slice(0, LIVE_SIZE)
    .map((s, i) => toRow(s, i + 1));

  const setAside = scored
    .filter((s) => s.preToken && s.reason !== null)
    .sort(byTvlDesc)
    .slice(0, SET_ASIDE_SIZE)
    .map((s, i) => toRow(s, i + 1));

  return { rows, live, set_aside: setAside };
}
