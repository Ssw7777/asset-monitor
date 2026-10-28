import type { ExchangeId } from "./types";

/** Public labels. Family Gate rows stay distinct from the personal Gate line. */
export const EXCHANGE_LABEL: Record<ExchangeId, string> = {
  okx: "OKX",
  binance: "Binance",
  gate: "Gate",
  gate_mom: "Gate妈妈",
  gate_brother: "Gate哥哥",
  bitget: "Bitget",
};

export function exchangeLabel(id: string): string {
  return EXCHANGE_LABEL[id as ExchangeId] || id;
}

/** Mom/brother reuse the Gate mark; there is no separate icon asset. */
export function exchangeIconId(id: string): string {
  if (id === "gate_mom" || id === "gate_brother") return "gate";
  return id;
}
