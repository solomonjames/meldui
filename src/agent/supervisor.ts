/**
 * Supervisor agent — evaluates worker output using Haiku via the Agent SDK.
 *
 * Uses the same auth mechanism as the worker agent (claude CLI OAuth),
 * so no separate ANTHROPIC_API_KEY is needed.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync } from "fs";
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

function findClaudeBinary(): string | undefined {
  const home = process.env.HOME ?? "";
  const candidates = [
    `${home}/.claude/bin/claude`,
    `${home}/.local/bin/claude`,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch {}
  }
  return undefined;
}

export async function evaluateSupervisor(
  params: SupervisorEvaluateParams,
): Promise<SupervisorEvaluateResult> {
  const systemPrompt = buildSystemPrompt(params.systemPrompt);
  const userMessage = buildUserMessage(params);
  const claudePath = findClaudeBinary();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Use the Agent SDK query() with maxTurns=1 and no tools —
      // this gives us a single Haiku response using the same OAuth auth
      // as the worker agent, without needing ANTHROPIC_API_KEY.
      const agentQuery = query({
        prompt: userMessage,
        options: {
          model: "claude-haiku-4-5-20251001",
          maxTurns: 1,
          systemPrompt: systemPrompt,
          tools: [],
          allowedTools: [],
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
          stderr: (data: string) => {
            process.stderr.write(`[supervisor-sdk-stderr] ${data}\n`);
          },
          settingSources: ["local", "project", "user"],
        } as never,
      });

      let resultText = "";
      for await (const message of agentQuery) {
        const msg = message as Record<string, unknown>;
        if (msg.type === "result") {
          const resultMsg = msg as { subtype?: string; result?: string };
          if (resultMsg.subtype === "success") {
            resultText = resultMsg.result ?? "";
          }
        }
      }

      if (!resultText) {
        throw new Error("No result text from supervisor query");
      }

      return parseResponse(resultText);
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
