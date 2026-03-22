/**
 * BM25 full-text search scoring for session .jsonl files.
 *
 * Swift source: Sources/KanbanCodeCore/UseCases/BM25Scorer.swift (86 lines)
 *
 * Constants: k1=1.2, b=0.4
 * Prefix matching for terms >= 3 chars
 * IDF: log((n - df + 0.5) / (df + 0.5) + 1)
 * recencyBoost: 3x today -> 1x at 30+ days (linear decay)
 * tokenize: split on non-alphanumeric, filter < 2 chars
 */

/** BM25 parameters. */
export const K1 = 1.2;
export const B = 0.4;

/**
 * Score a document against query terms using BM25.
 *
 * @param terms - Query terms (lowercased, split by whitespace)
 * @param documentTokens - Tokens from the document (lowercased words)
 * @param avgDocLength - Average document length across corpus
 * @param docCount - Total number of documents
 * @param docFreqs - Number of documents containing each term
 * @param recencyBoost - Multiplier for document recency (1.0 = no boost)
 */
export function score(
  terms: string[],
  documentTokens: string[],
  avgDocLength: number,
  docCount: number,
  docFreqs: Record<string, number>,
  recencyBoost: number = 1.0,
): number {
  const docLength = documentTokens.length;
  if (docLength === 0 || avgDocLength === 0) return 0;

  // Build term frequency map for the document
  const tf: Record<string, number> = {};
  for (const token of documentTokens) {
    tf[token] = (tf[token] ?? 0) + 1;
  }

  let totalScore = 0;

  for (const term of terms) {
    let termFreq: number;
    let dfCount: number;

    // Check for prefix match when term has >= 3 chars
    if (term.length >= 3) {
      termFreq = documentTokens.filter(t => t.startsWith(term)).length;
      dfCount = Object.entries(docFreqs)
        .filter(([key]) => key.startsWith(term))
        .reduce((sum, [, val]) => sum + val, 0);
    } else {
      termFreq = tf[term] ?? 0;
      dfCount = docFreqs[term] ?? 0;
    }

    if (termFreq === 0) continue;

    // IDF component
    const n = docCount;
    const df = Math.max(dfCount, 0.5);
    const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1);

    // TF component with BM25 normalization
    const tfNorm =
      (termFreq * (K1 + 1)) /
      (termFreq + K1 * (1 - B + (B * docLength) / avgDocLength));

    totalScore += idf * tfNorm;
  }

  return totalScore * recencyBoost;
}

/**
 * Calculate recency boost based on file modification time.
 * Recent files get a stronger boost (up to 3x for today, decaying over 30 days).
 */
export function recencyBoost(modifiedTime: Date): number {
  const daysAgo = (Date.now() - modifiedTime.getTime()) / 86400000;
  if (daysAgo <= 0) return 3.0;
  if (daysAgo >= 30) return 1.0;
  // Linear decay from 3.0 to 1.0 over 30 days
  return 3.0 - (2.0 * daysAgo) / 30.0;
}

/**
 * Tokenize text into lowercase words.
 * Splits on non-alphanumeric characters, filters tokens shorter than 2 chars.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2);
}
