import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getCurrentUser } from "@/lib/session";
import { parseChat, SYSTEM_PROMPT, TOOLS } from "@/lib/assistant";
import { runAssistantTool } from "@/lib/assistant-db";

// A question can take a few lookups, each a round trip to Claude.
export const maxDuration = 120;

const MODEL = "claude-sonnet-5-5";
/** Lookups per question before it gives up — a loop guard, far above a real question's two or three. */
const MAX_STEPS = 8;

const TODAY = () =>
  new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });

/**
 * POST { messages: [{ role, text }] } → { answer }.
 *
 * The office assistant (lib/assistant). Anyone signed in to the landlord
 * side can ask, viewers included: every lookup only reads, and only within
 * their own companies. The API key is the server's ANTHROPIC_API_KEY; with
 * none set the box says it isn't switched on rather than failing.
 */
export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "The assistant isn't switched on yet: add ANTHROPIC_API_KEY to the site's settings." },
      { status: 503 }
    );
  }
  const parsed = parseChat(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = parsed.turns.map((t) => ({ role: t.role, content: t.text }));
  const usage = { input: 0, cached: 0, output: 0 };

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // Low effort: these are quick lookups, not hard reasoning, and it
        // keeps each answer to a cent or two.
        output_config: { effort: "low" },
        // If Claude's safety checks decline a question (rare for questions
        // about rent), the API retries it on a fallback model by itself.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // Caches the conversation so far, so each lookup in a question
        // re-reads it at a tenth of the price.
        cache_control: { type: "ephemeral" },
        system: [
          { type: "text", text: SYSTEM_PROMPT },
          { type: "text", text: `Today is ${TODAY()}. The person asking is ${me.name || me.email}.` },
        ],
        tools: TOOLS,
        messages,
      });
      usage.input += response.usage.input_tokens;
      usage.cached += response.usage.cache_read_input_tokens ?? 0;
      usage.output += response.usage.output_tokens;

      if (response.stop_reason === "refusal") {
        return NextResponse.json({ answer: "Sorry — I can't help with that one." });
      }
      if (response.stop_reason !== "tool_use") {
        const answer = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n\n")
          .trim();
        console.log(`assistant: ${me.id} ${step + 1} steps, tokens in ${usage.input} (+${usage.cached} cached) out ${usage.output}`);
        return NextResponse.json({
          answer: answer || "I couldn't find an answer to that.",
          ...(response.stop_reason === "max_tokens" ? { cut: true } : {}),
        });
      }

      // Hand back everything Claude said, unchanged, then every lookup's
      // result together in one message.
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        try {
          results.push({ type: "tool_result", tool_use_id: block.id, content: await runAssistantTool(me.id, block.name, block.input) });
        } catch (err) {
          console.error("assistant tool failed", block.name, err);
          results.push({ type: "tool_result", tool_use_id: block.id, content: "That lookup failed.", is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
    return NextResponse.json({ answer: "That took too many lookups — try asking a narrower question." });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "The assistant's API key was refused. Check ANTHROPIC_API_KEY." }, { status: 503 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "The assistant is busy — try again in a minute." }, { status: 503 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("assistant API error", err.status, err.message);
      const credit = /credit balance/i.test(err.message);
      return NextResponse.json(
        { error: credit ? "The assistant's API credit has run out." : "The assistant couldn't answer just now. Try again." },
        { status: 502 }
      );
    }
    console.error("assistant failed", err);
    return NextResponse.json({ error: "The assistant couldn't answer just now. Try again." }, { status: 500 });
  }
}
