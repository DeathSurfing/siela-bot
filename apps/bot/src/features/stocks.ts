export interface StockSeed {
  symbol: string;
  name: string;
  sector: string;
  description: string;
  basePrice: number;
  volatility: number;
}

export const STOCK_TICK_MS = 60 * 60 * 1000;
export const MAX_CATCHUP_TICKS = 24;
export const STOCK_HISTORY_LENGTH = 24;
export const TRADE_FEE_RATE = 0.01;
export const MIN_STOCK_PRICE = 5;
export const MAX_STOCK_PRICE = 100_000;

export const STOCK_SEEDS: StockSeed[] = [
  {
    symbol: "SIELA",
    name: "Siela Coin",
    sector: "Index",
    description: "The house, but polite.",
    basePrice: 100,
    volatility: 120,
  },
  {
    symbol: "DELULU",
    name: "Delulu Labs",
    sector: "AI",
    description: "Ships a model whenever someone asks.",
    basePrice: 60,
    volatility: 650,
  },
  {
    symbol: "TAMB",
    name: "Tambola Trust",
    sector: "Games",
    description: "Three numbers from glory.",
    basePrice: 40,
    volatility: 420,
  },
  {
    symbol: "KIT",
    name: "KittenTTS",
    sector: "Audio",
    description: "One voice, many pronunciations.",
    basePrice: 75,
    volatility: 280,
  },
  {
    symbol: "YAP",
    name: "Yapper Inc.",
    sector: "Social",
    description: "Monetizes the group chat.",
    basePrice: 30,
    volatility: 520,
  },
  {
    symbol: "CHODU",
    name: "Chodu Corp.",
    sector: "Chaos",
    description: "No business model. Strong brand.",
    basePrice: 20,
    volatility: 900,
  },
];

const EVENT_HEADLINES: Record<string, string[]> = {
  SIELA: [
    "Siela Coin reaches a new high on nothing at all",
    "Analysts confirm the index is just vibes",
  ],
  DELULU: [
    "Delulu Labs ships a model nobody asked for",
    "Delulu Labs denies the model exists",
    "GPU bill arrives; investors remain calm",
  ],
  TAMB: [
    "Tambola Trust denies ticket-rigging allegations",
    "Full house announced twice; probe launched",
    "Lucky number seven breaks the market",
  ],
  KIT: [
    "KittenTTS mispronounces pizza, shares wobble",
    "Rival clones the Bruno voice overnight",
    "New voice pack ships exactly on time",
  ],
  YAP: [
    "Yapper Inc. posts its ten-thousandth take",
    "Group chat declares bankruptcy, then recovers",
    "Reply-all feature drives record engagement",
  ],
  CHODU: [
    "Chodu Corp. announces synergy with itself",
    "CEO forgets the earnings call",
    "Brand value rises on pure chaos",
  ],
};

export interface StockState {
  symbol: string;
  price: number;
  fairValue: number;
  volatility: number;
  history: number[];
}

export interface StockStep extends StockState {
  event: string | null;
}

export interface MarketStockView {
  symbol: string;
  name: string;
  sector: string;
  description: string;
  price: number;
  fairValue: number;
  history: number[];
  lastEvent: string | null;
  lastEventAt: Date | null;
}

export interface MarketView {
  stocks: MarketStockView[];
  index: number;
  indexChange: number;
  lastTickAt: Date;
  nextTickAt: Date;
}

export interface HoldingView {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
  price: number;
  value: number;
  cost: number;
  pnl: number;
  pnlPct: number;
}

export interface PortfolioView {
  cash: number;
  holdings: HoldingView[];
  holdingsValue: number;
  netWorth: number;
  unrealized: number;
}

export interface StockBuyResult {
  symbol: string;
  shares: number;
  price: number;
  fee: number;
  total: number;
  balance: number;
}

export interface StockSellResult {
  symbol: string;
  shares: number;
  price: number;
  fee: number;
  proceeds: number;
  pnl: number;
  balance: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function gaussian(rng: () => number): number {
  const u = Math.max(Number.EPSILON, rng());
  const v = Math.max(Number.EPSILON, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function advanceStock(
  state: StockState,
  rng: () => number = Math.random,
  eventChance = 0.01,
): StockStep {
  const fairValue = clamp(
    Math.round(state.fairValue * (1 + gaussian(rng) * 0.01)),
    MIN_STOCK_PRICE,
    MAX_STOCK_PRICE,
  );
  const reversion = 0.08 * ((fairValue - state.price) / Math.max(1, fairValue));
  const noise = gaussian(rng) * (state.volatility / 10_000);
  let price = state.price * (1 + reversion + noise);
  let event: string | null = null;

  if (rng() < eventChance) {
    const headlines = EVENT_HEADLINES[state.symbol] ?? [];
    if (headlines.length) {
      const direction = rng() < 0.5 ? -1 : 1;
      const jump = direction * (0.06 + rng() * 0.14);
      price *= 1 + jump;
      event = headlines[Math.floor(rng() * headlines.length)] ?? null;
    }
  }

  const rounded = clamp(Math.round(price), MIN_STOCK_PRICE, MAX_STOCK_PRICE);
  return {
    symbol: state.symbol,
    price: rounded,
    fairValue,
    volatility: state.volatility,
    history: [...state.history, rounded].slice(-STOCK_HISTORY_LENGTH),
    event,
  };
}

export function sparkline(history: number[], width = 12): string {
  const values = history.slice(-width);
  if (!values.length) return "▱".repeat(width);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const levels = "▁▂▃▄▅▆▇█";
  return values
    .map((value) => {
      const ratio = max === min ? 0.5 : (value - min) / (max - min);
      return levels[Math.round(ratio * (levels.length - 1))];
    })
    .join("");
}

export function changePct(history: number[]): number {
  if (history.length < 2) return 0;
  const first = history[0]!;
  const last = history[history.length - 1]!;
  if (first <= 0) return 0;
  return ((last - first) / first) * 100;
}

export function marketIndex(stocks: Array<Pick<MarketStockView, "symbol" | "price">>): number {
  const prices = new Map(stocks.map((stock) => [stock.symbol, stock.price]));
  const ratios = STOCK_SEEDS.map((seed) => (prices.get(seed.symbol) ?? seed.basePrice) / seed.basePrice);
  return 100 * (ratios.reduce((total, ratio) => total + ratio, 0) / ratios.length);
}

export function indexChange(stocks: MarketStockView[]): number {
  const first = marketIndex(
    stocks.map((stock) => ({
      symbol: stock.symbol,
      price: stock.history[0] ?? stock.price,
    })),
  );
  const last = marketIndex(stocks);
  return first <= 0 ? 0 : ((last - first) / first) * 100;
}

export function tradeFee(gross: number): number {
  if (gross <= 0) return 0;
  return Math.max(1, Math.ceil(gross * TRADE_FEE_RATE));
}

export function nextAverageCost(
  oldShares: number,
  oldAverage: number,
  addedShares: number,
  addedCost: number,
): number {
  const totalShares = oldShares + addedShares;
  if (totalShares <= 0) return 0;
  return Math.round((oldShares * oldAverage + addedCost) / totalShares);
}

export function stockSeed(symbol: string): StockSeed | null {
  return STOCK_SEEDS.find((seed) => seed.symbol === symbol.toUpperCase()) ?? null;
}
