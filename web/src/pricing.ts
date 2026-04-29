// Token pricing in USD per 1M tokens (input / output).
// Rough approximations, matched by substring on the model name.
type Price = { in: number; out: number };

const PRICES: Array<{ match: RegExp; price: Price; label: string }> = [
  // Anthropic
  { match: /opus[-_ ]?4/i, price: { in: 15, out: 75 }, label: 'Claude Opus 4.x' },
  { match: /sonnet[-_ ]?4/i, price: { in: 3, out: 15 }, label: 'Claude Sonnet 4.x' },
  { match: /haiku[-_ ]?4/i, price: { in: 0.8, out: 4 }, label: 'Claude Haiku 4.x' },
  { match: /opus[-_ ]?3/i, price: { in: 15, out: 75 }, label: 'Claude Opus 3.x' },
  { match: /sonnet[-_ ]?3/i, price: { in: 3, out: 15 }, label: 'Claude Sonnet 3.x' },
  { match: /haiku[-_ ]?3/i, price: { in: 0.25, out: 1.25 }, label: 'Claude Haiku 3.x' },
  // OpenAI
  { match: /gpt-?5\.?\d*-?codex/i, price: { in: 1.25, out: 10 }, label: 'GPT-5 Codex' },
  { match: /gpt-?5\.?\d*[-_ ]?mini/i, price: { in: 0.25, out: 2 }, label: 'GPT-5 mini' },
  { match: /gpt-?5/i, price: { in: 1.25, out: 10 }, label: 'GPT-5' },
  { match: /gpt-?4\.?1/i, price: { in: 2, out: 8 }, label: 'GPT-4.1' },
  { match: /gpt-?4o[-_ ]?mini/i, price: { in: 0.15, out: 0.6 }, label: 'GPT-4o mini' },
  { match: /gpt-?4o/i, price: { in: 2.5, out: 10 }, label: 'GPT-4o' },
  { match: /o3[-_ ]?mini/i, price: { in: 1.1, out: 4.4 }, label: 'o3-mini' },
  { match: /o1[-_ ]?mini/i, price: { in: 1.1, out: 4.4 }, label: 'o1-mini' },
  { match: /o1/i, price: { in: 15, out: 60 }, label: 'o1' },
  // Google
  { match: /gemini.*flash/i, price: { in: 0.075, out: 0.3 }, label: 'Gemini Flash' },
  { match: /gemini.*pro/i, price: { in: 1.25, out: 5 }, label: 'Gemini Pro' },
];

export function priceFor(model?: string | null): { price: Price; label: string } | null {
  if (!model) return null;
  for (const e of PRICES) {
    if (e.match.test(model)) return { price: e.price, label: e.label };
  }
  return null;
}

export function estimateCostUsd(model: string | null | undefined, tokensIn: number, tokensOut: number): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (tokensIn / 1_000_000) * p.price.in + (tokensOut / 1_000_000) * p.price.out;
}

export function formatUsd(n: number): string {
  if (n < 0.01) return `<$0.01`;
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(0)}`;
}
