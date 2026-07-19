// 軽量・オフラインのトピック類似度計算。
// 日本語は分かち書きが難しいため、形態素解析なしでも実用的な
// 文字バイグラム(2-gram)の重なり具合(Dice係数)で近似する。

const STRIP_PATTERN = /[\s　!?！？。、,.・「」『』()（）\-ー~〜:：;；"'”“'’…]/g;

function normalize(text) {
  return text.replace(STRIP_PATTERN, "").toLowerCase();
}

/**
 * テキストから文字バイグラムの出現回数マップを作る。
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function toBigramMap(text) {
  const norm = normalize(text);
  const map = new Map();
  if (norm.length === 0) return map;
  if (norm.length === 1) {
    map.set(norm, 1);
    return map;
  }
  for (let i = 0; i < norm.length - 1; i++) {
    const gram = norm.slice(i, i + 2);
    map.set(gram, (map.get(gram) || 0) + 1);
  }
  return map;
}

/**
 * 2つのバイグラムマップからDice係数(0〜1)を求める。
 * 1に近いほどトピックが似ている。
 */
export function bigramSimilarity(mapA, mapB) {
  if (mapA.size === 0 || mapB.size === 0) return 0;
  const [small, large] = mapA.size < mapB.size ? [mapA, mapB] : [mapB, mapA];
  let intersection = 0;
  for (const [gram, count] of small) {
    const other = large.get(gram);
    if (other) intersection += Math.min(count, other);
  }
  let totalA = 0;
  for (const v of mapA.values()) totalA += v;
  let totalB = 0;
  for (const v of mapB.values()) totalB += v;
  const denom = totalA + totalB;
  return denom === 0 ? 0 : (2 * intersection) / denom;
}
