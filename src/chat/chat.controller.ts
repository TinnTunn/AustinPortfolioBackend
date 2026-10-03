import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { env } from "../config/env";
import { OriginGuard } from "../common/origin.guard";
import { RollingLimit } from "../common/rolling-limit";
import { ContentService } from "../content/content.service";
import { buildSystemPrompt } from "./assistant-knowledge";
import { ChatDto } from "./chat.dto";
import { drainSse, raceModels } from "./gemini";

/**
 * POST /chat — Tinn. Streams a grounded Gemini reply back as plain-text
 * deltas. The API key never leaves the server; the per-IP throttle keeps a
 * visitor from running up the free quota.
 */
@Controller("chat")
@UseGuards(OriginGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);
  // Across all visitors: keeps a burst from many IPs from draining the free
  // Gemini quota for everyone (the per-IP throttle below handles single users).
  private readonly globalLimit = new RollingLimit(30, 60_000);

  constructor(private readonly content: ContentService) {}

  @Post()
  @Throttle({ default: { limit: 25, ttl: 5 * 60_000 } })
  async chat(@Body() dto: ChatDto, @Res() res: Response) {
    const apiKey = env().geminiApiKey;
    if (!apiKey) throw new ServiceUnavailableException("The assistant isn't configured yet.");
    if (!this.globalLimit.take()) {
      this.logger.warn("Global chat limit reached");
      throw new HttpException("Tinn is busy right now — please try again in a minute.", HttpStatus.TOO_MANY_REQUESTS);
    }

    // Gemini expects the conversation to open with the visitor and alternate
    // turns, so drop leading model turns and fold same-role neighbours together.
    const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
    for (const m of dto.messages.slice(-16)) {
      const role = m.role === "assistant" ? "model" : "user";
      const text = m.text.trim();
      if (!text || (contents.length === 0 && role === "model")) continue;
      const last = contents[contents.length - 1];
      if (last?.role === role) last.parts[0].text += `\n\n${text}`;
      else contents.push({ role, parts: [{ text }] });
    }
    if (contents.length === 0 || contents[contents.length - 1].role !== "user") {
      throw new BadRequestException("Bad request.");
    }

    const payload = JSON.stringify({
      // Same (cached) Experience/Projects content the site shows.
      systemInstruction: { parts: [{ text: buildSystemPrompt(await this.content.published()) }] },
      contents,
      generationConfig: { temperature: 0.3, topP: 0.9, maxOutputTokens: 600 },
    });

    const open = await raceModels(apiKey, payload);
    if (!open) {
      this.logger.error("No model answered; the visitor saw the fallback message");
      throw new BadGatewayException("The assistant is unavailable right now. Please try again.");
    }

    // The widget shows plain text, so Markdown emphasis the model slips in
    // anyway would appear as literal asterisks; nothing Tinn says needs them.
    const emit = (text: string) => res.write(text.replace(/\*/g, ""));
    res.status(200).set({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.on("close", () => void open.reader.cancel().catch(() => undefined)); // visitor closed the chat

    const { reader, decoder, pending } = open;
    let buffer = open.buffer;
    try {
      for (const text of pending) emit(text);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { texts, rest } = drainSse(buffer);
        buffer = rest;
        for (const text of texts) emit(text);
      }
    } catch {
      /* upstream dropped mid-answer — close with what we have */
    } finally {
      res.end();
    }
  }
}
