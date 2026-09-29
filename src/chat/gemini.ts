import { TextDecoder } from "node:util";
import { Logger } from "@nestjs/common";

/**
 * Hedged streaming calls to Google's Gemini API (free tier).
 *
 * Free-tier latency is erratic per request (the same model has been measured
 * at 1s and at 97s back to back), so requests are *hedged*: ask one model, and
 * if it hasn't started answering after HEDGE_AFTER_MS, ask the next one too.
 * Whichever starts first wins; the others are cancelled. Don't "simplify"
 * this back to a single model.
 */

// Tried in this order. The aliases track Google's current free Flash models;
// the pinned Flash-Lites add separate queues. A model that errors (e.g. is
// retired) simply loses the race.
const MODELS = ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest"];
// Gemini's "high demand" 503s usually clear within seconds, so when every
// model fails, the whole list gets one more pass after a short pause.
const ATTEMPTS = [...MODELS, ...MODELS];
const RETRY_PAUSE_MS = 1_000;
const HEDGE_AFTER_MS = 2_500;
const DEADLINE_MS = 25_000;

const logger = new Logger("Gemini");

interface OpenStream {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
  pending: string[];
}

/** Pulls complete SSE lines out of `buffer`; returns their text deltas and the unfinished tail. */
export function drainSse(buffer: string): { texts: string[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const texts: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parts = JSON.parse(data)?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) for (const p of parts) if (p?.text) texts.push(p.text);
    } catch {
      /* ignore keep-alive / partial frames */
    }
  }
  return { texts, rest };
}

/** Opens a streaming call and waits for its first words; null if it fails or is aborted. */
async function openStream(model: string, apiKey: string, payload: string, signal: AbortSignal): Promise<OpenStream | null> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      // The key goes in a header, not the URL, so it can't end up in request logs.
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: payload,
      signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      logger.warn(`${model}: HTTP ${res.status} ${detail.replace(/\s+/g, " ").slice(0, 160)}`);
      return null;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        logger.warn(`${model}: stream ended without text`);
        return null;
      }
      buffer += decoder.decode(value, { stream: true });
      const { texts, rest } = drainSse(buffer);
      buffer = rest;
      if (texts.length) return { reader, decoder, buffer, pending: texts };
    }
  } catch (err) {
    // An abort just means another model won the race; anything else is worth logging.
    if (!signal.aborted) logger.warn(`${model}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Hedged race across ATTEMPTS: start the first; launch the next after
 * HEDGE_AFTER_MS (or as soon as one fails); the first to produce text wins.
 */
export function raceModels(apiKey: string, payload: string): Promise<OpenStream | null> {
  return new Promise((resolve) => {
    const attempts: AbortController[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let next = 0;
    let inFlight = 0;
    let done = false;

    const finish = (result: OpenStream | null, winner?: AbortController) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      attempts.forEach((c) => c !== winner && c.abort());
      resolve(result);
    };

    const launch = () => {
      if (done || next >= ATTEMPTS.length) return;
      const controller = new AbortController();
      attempts.push(controller);
      inFlight++;
      void openStream(ATTEMPTS[next++], apiKey, payload, controller.signal).then((result) => {
        inFlight--;
        if (result) {
          if (done) void result.reader.cancel(); // lost the race
          else finish(result, controller);
        } else if (!done) {
          // Failed fast: move on without waiting for the hedge timer, pausing
          // briefly only before starting the second pass.
          if (next < ATTEMPTS.length) {
            timers.push(setTimeout(launch, next % MODELS.length === 0 ? RETRY_PAUSE_MS : 0));
          } else if (inFlight === 0) {
            finish(null);
          }
        }
      });
      if (next < ATTEMPTS.length) timers.push(setTimeout(launch, HEDGE_AFTER_MS));
    };

    timers.push(setTimeout(() => finish(null), DEADLINE_MS));
    launch();
  });
}
