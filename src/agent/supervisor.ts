/**
 * Supervisor agent — evaluates worker output using Haiku
 * and decides whether to reply or advance.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupervisorEvaluateParams, SupervisorEvaluateResult } from "./protocol";

const DEFAULT_PREAMBLE = `You are a workflow supervisor for MeldUI. An AI coding agent is working on a ticket, and you are evaluating its latest response to decide what to do next.

You have two actions available:
- "reply": The agent is asking a question or needs guidance. Respond on behalf of the user.
- "advance": The agent has completed the current step's work. Move to the next step.`;

const DEFAULT_GUIDELINES = `Guidelines for your decision:
- If the agent is asking a clarifying question, answer it using the ticket context provided.
- If the agent is asking for permission or confirmation to proceed, approve it.
- If the agent says it's done, or its output clearly fulfills the step's prompt, choose "advance".
- If the agent is stuck or going in circles, choose "advance" to move on.
- Keep your replies concise and direct. You are unblocking the agent, not collaborating.`;

const JSON_FORMAT_INSTRUCTIONS = `Respond with JSON only:
{ "action": "reply", "message": "your response here", "reasoning": "why you chose this" }
or
{ "action": "advance", "reasoning": "why the step is complete" }`;

function buildSystemPrompt(customPrompt?: string): string {
  const guidelines = customPrompt ?? DEFAULT_GUIDELINES;
  return `${DEFAULT_PREAMBLE}\n\n${guidelines}\n\n${JSON_FORMAT_INSTRUCTIONS}`;
}

function buildUserMessage(params: SupervisorEvaluateParams): string {
  const { workerResponse, ticketContext } = params;
  const step = ticketContext.currentStep;
  return `## Ticket
Title: ${ticketContext.title}
Description: ${ticketContext.description}
${ticketContext.acceptanceCriteria ? `Acceptance Criteria: ${ticketContext.acceptanceCriteria}` : ""}

## Current Step [${step.index + 1}]: ${step.name}
Prompt: ${step.prompt}

## Agent's Response
${workerResponse}`;
}

function parseResponse(text: string): SupervisorEvaluateResult {
  // Try to extract JSON from the response (Haiku may wrap in markdown)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in response");
  }
  const parsed = JSON.parse(jsonMatch[0]);
  if (parsed.action !== "reply" && parsed.action !== "advance") {
    throw new Error(`Invalid action: ${parsed.action}`);
  }
  return {
    action: parsed.action,
    message: parsed.message,
    reasoning: parsed.reasoning,
  };
}

export async function evaluateSupervisor(
  params: SupervisorEvaluateParams,
): Promise<SupervisorEvaluateResult> {
  const client = new Anthropic();
  const systemPrompt = buildSystemPrompt(params.systemPrompt);
  const userMessage = buildUserMessage(params);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

      return parseResponse(text);
    } catch (err) {
      if (attempt === 0) {
        process.stderr.write(
          `[sidecar] supervisor: attempt ${attempt + 1} failed: ${err}, retrying\n`,
        );
        continue;
      }
      // Second attempt failed — fall back to advance
      process.stderr.write(
        `[sidecar] supervisor: all attempts failed: ${err}, falling back to advance\n`,
      );
      return { action: "advance", reasoning: "Supervisor evaluation failed, advancing by default" };
    }
  }

  // Unreachable, but satisfy TypeScript
  return { action: "advance", reasoning: "Supervisor evaluation failed" };
}
