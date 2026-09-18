/**
 * Zerion 免费额度按 Key 独立计算（300 次/天/Key）。
 * 支持配置多把 Key 轮转使用（ZERION_API_KEYS = 逗号分隔），等效额度成倍放大；
 * 轮转计数器在每个 Serverless 实例内自增，实例间整体分布近似均匀。
 */

let rotation = 0;

export function zerionKeys(): string[] {
  const primary = (process.env.ZERION_API_KEY || "").trim();
  const extra = (process.env.ZERION_API_KEYS || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const keys = extra.includes(primary) ? extra : [...extra, primary].filter(Boolean);
  return keys;
}

/** 轮转取下一把 Key；没有配置任何 Key 时返回 null。 */
export function nextZerionKey(): string | null {
  const keys = zerionKeys();
  if (!keys.length) return null;
  const key = keys[rotation % keys.length];
  rotation += 1;
  return key;
}
