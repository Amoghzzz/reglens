import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Shared Gemini helpers.
 * On Gemini 3.x, maxOutputTokens covers the model's internal "thinking" as well as the answer, so we set
 * an explicit thinking level and a generous output limit. thinkingConfig isn't in this SDK version's types,
 * hence the casts; it is passed through to the API. Each call falls back to plain settings, then an older
 * model, if the preferred settings are rejected.
 */

export const FLASH_MODEL_NAME = 'gemini-3.5-flash';
export const LITE_MODEL_NAME = 'gemini-3.5-flash-lite';
export const FALLBACK_MODEL_NAME = 'gemini-2.5-flash';

/**
 * Free-tier budget: Flash allows about 20 requests a day, Flash-Lite about 500. So Flash writes the answer and
 * Flash-Lite does the helper work (rewriting questions, checking claims, extracting checklists). If a model is out
 * of quota the call moves down the chain. REGLENS_MODEL forces one model first for everything (the eval uses it so
 * every question is answered by the same model).
 */
export type ModelRole = 'answer' | 'helper';

function chainFor(role: ModelRole): string[] {
  const base = role === 'answer' ? [FLASH_MODEL_NAME, LITE_MODEL_NAME, FALLBACK_MODEL_NAME] : [LITE_MODEL_NAME, FALLBACK_MODEL_NAME, FLASH_MODEL_NAME];
  const forced = process.env.REGLENS_MODEL?.trim();
  return forced ? [forced, ...base.filter((m) => m !== forced)] : base;
}

export type ThinkingLevel = 'minimal' | 'low' | 'medium';

export function getKey(apiKey?: string): string {
  const key = apiKey || process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY is not configured in .env.local.');
  return key;
}

export function attemptsFor(
  thinking: ThinkingLevel,
  extra: Record<string, unknown> = {},
  maxOutputTokens = 32768,
  role: ModelRole = 'answer',
): [string, any][] {
  const plain = { temperature: 0.1, maxOutputTokens, ...extra };
  const [first, ...rest] = chainFor(role);
  // The first model is tried with a thinking level, then plain in case that setting is rejected.
  return [[first, { ...plain, thinkingConfig: { thinkingLevel: thinking } }], [first, plain], ...rest.map((m): [string, any] => [m, plain])];
}

// ---------------------------------------------------------------- Free-tier rate limits

/** What a Gemini error says about quota: whether it is a quota error, whether it is the daily one, and how long to wait. */
export function quotaInfo(err: unknown): { isQuota: boolean; daily: boolean; retryMs: number } {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const isQuota = /\b429\b|quota|RESOURCE_EXHAUSTED|rate limit/i.test(msg);
  const daily = isQuota && /PerDay|per day|daily/i.test(msg);
  const secs = Number(msg.match(/retry in ([\d.]+)s/i)?.[1] ?? msg.match(/"retryDelay":"(\d+)s"/)?.[1] ?? NaN);
  return { isQuota, daily, retryMs: Number.isFinite(secs) ? Math.ceil(secs * 1000) + 1500 : 30000 };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Optional throttle: set REGLENS_RPM (the eval script sets it to 5) to keep each model under its per-minute limit.
const recent = new Map<string, number[]>();
export async function throttle(model: string): Promise<void> {
  const base = Number(process.env.REGLENS_RPM || 0);
  if (!base) return;
  const rpm = model.includes('lite') ? base * 2 : base;
  for (;;) {
    const now = Date.now();
    const times = (recent.get(model) ?? []).filter((t) => now - t < 60_000);
    if (times.length < rpm) {
      times.push(now);
      recent.set(model, times);
      return;
    }
    await sleep(60_000 - (now - times[0]) + 250);
  }
}

/**
 * Runs a call through the fallback chain. A per-minute quota error on a model skips that model's other settings;
 * a model that has used its daily allowance is skipped; if the rest are rate-limited, waits as long as Gemini asks
 * (up to `maxWaits` times).
 */
export async function withFallbacks<T>(
  attempts: [string, any][],
  call: (model: string, generationConfig: any) => Promise<T>,
  opts: { maxWaits?: number; label?: string } = {},
): Promise<{ value: T; model: string }> {
  const maxWaits = opts.maxWaits ?? (process.env.REGLENS_RPM ? 3 : 1);
  let lastError: unknown;
  const exhausted = new Set<string>();
  for (let round = 0; round <= maxWaits; round++) {
    const limited = new Set<string>(exhausted);
    let waitMs = 0;
    for (const [model, generationConfig] of attempts) {
      if (limited.has(model)) continue;
      try {
        await throttle(model);
        return { value: await call(model, generationConfig), model };
      } catch (err) {
        lastError = err;
        const q = quotaInfo(err);
        if (q.daily) {
          // This model is done for the day; other models have their own allowance.
          exhausted.add(model);
          limited.add(model);
        } else if (q.isQuota) {
          limited.add(model);
          waitMs = Math.max(waitMs, q.retryMs);
        }
        console.warn(`${opts.label ?? 'AI'} attempt with ${model} failed: ${(err as Error)?.message?.slice(0, 160)}`);
      }
    }
    if (!waitMs || round === maxWaits || attempts.every(([m]) => exhausted.has(m))) break;
    console.warn(`Rate limited by Gemini; waiting ${Math.round(waitMs / 1000)}s before retrying.`);
    await sleep(Math.min(waitMs, 65_000));
  }
  throw lastError instanceof Error ? lastError : new Error('The AI service is unavailable.');
}

/** One-shot text generation with fallbacks. Returns the text and the model that produced it. */
export async function generateText(
  prompt: string,
  opts: { apiKey?: string; thinking?: ThinkingLevel; json?: boolean; maxOutputTokens?: number; role?: ModelRole } = {},
): Promise<{ text: string; model: string; finishReason?: string }> {
  const genAI = new GoogleGenerativeAI(getKey(opts.apiKey));
  const extra = opts.json ? { responseMimeType: 'application/json', temperature: 0 } : {};
  const { value: res, model } = await withFallbacks(
    attemptsFor(opts.thinking ?? 'low', extra, opts.maxOutputTokens, opts.role ?? 'helper'),
    (m, generationConfig) => genAI.getGenerativeModel({ model: m, generationConfig }).generateContent(prompt),
  );
  return {
    text: res.response.text(),
    model,
    finishReason: res.response.candidates?.[0]?.finishReason as string | undefined,
  };
}

/** Generates JSON and parses it, tolerating code fences or stray text around the JSON. */
export async function generateJson<T>(
  prompt: string,
  opts: { apiKey?: string; thinking?: ThinkingLevel; maxOutputTokens?: number; role?: ModelRole } = {},
): Promise<{ data: T; model: string }> {
  const { text, model } = await generateText(prompt, { ...opts, json: true });
  return { data: parseJsonLoose<T>(text), model };
}

export function parseJsonLoose<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.search(/[\[{]/);
    const endObj = cleaned.lastIndexOf('}');
    const endArr = cleaned.lastIndexOf(']');
    const end = Math.max(endObj, endArr);
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error('The AI returned an answer that could not be read as data.');
  }
}

/** Runs an async iterator with an inactivity limit; yields values until done or until it goes quiet. */
export async function* withIdleTimeout<T>(
  iterable: AsyncIterable<T>,
  firstMs: number,
  idleMs: number,
  onTimeout: () => void,
): AsyncGenerator<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  let started = false;
  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<'idle'>((resolve) => {
      timer = setTimeout(() => resolve('idle'), started ? idleMs : firstMs);
    });
    const next = await Promise.race([iterator.next(), idle]);
    clearTimeout(timer);
    if (next === 'idle') {
      onTimeout();
      iterator.return?.(undefined as never)?.catch?.(() => {});
      return;
    }
    if (next.done) return;
    started = true;
    yield next.value;
  }
}
