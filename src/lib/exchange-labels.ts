import type { ExchangeId } from "./types";

/** Public labels for exchange rows. */
export const EXCHANGE_LABEL: Record<ExchangeId, string> = {
  okx: "OKX",
  binance: "Binance",
  gate: "Gate",
  gate_mom: "Gate B",
  gate_brother: "Gate C",
  bitget: "Bitget",
};

export function exchangeLabel(id: string): string {
  return EXCHANGE_LABEL[id as ExchangeId] || id;
}

/** Extra Gate accounts reuse the Gate mark; there is no separate icon asset. */
export function exchangeIconId(id: string): string {
  if (id === "gate_mom" || id === "gate_brother") return "gate";
  return id;
}
