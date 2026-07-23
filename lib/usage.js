// Haiku 4.5 pricing, $ per million tokens (Anthropic API rates, verified against
// the current pricing table — see README for the source). Cache write is priced
// at 1.25x base input (5-minute ephemeral TTL); cache read at 0.1x base input.
export const HAIKU_PRICING = {
  inputPerMTok: 1.0,
  outputPerMTok: 5.0,
  cacheWritePerMTok: 1.25,
  cacheReadPerMTok: 0.1,
};

export function emptyUsage() {
  return { calls: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
}

export function addUsage(totals, usage) {
  totals.calls += 1;
  totals.inputTokens += usage?.inputTokens || 0;
  totals.outputTokens += usage?.outputTokens || 0;
  totals.cacheWriteTokens += usage?.cacheWriteTokens || 0;
  totals.cacheReadTokens += usage?.cacheReadTokens || 0;
  return totals;
}

export function sumUsage(a, b) {
  return {
    calls: a.calls + b.calls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

export function costUSD(totals) {
  return (
    (totals.inputTokens / 1e6) * HAIKU_PRICING.inputPerMTok +
    (totals.outputTokens / 1e6) * HAIKU_PRICING.outputPerMTok +
    (totals.cacheWriteTokens / 1e6) * HAIKU_PRICING.cacheWritePerMTok +
    (totals.cacheReadTokens / 1e6) * HAIKU_PRICING.cacheReadPerMTok
  );
}

export function usageBreakdown(totals) {
  return { ...totals, costUSD: Math.round(costUSD(totals) * 1e8) / 1e8 };
}
