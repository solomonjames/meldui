/**
 * Supervisor agent — evaluates worker output by spawning a separate agent query.
 *
 * Uses the same query() function and auth mechanism as the main worker agent.
 * The supervisor reads the agent's last response, the ticket context, and
 * generates an intelligent reply (answering questions, approving actions, etc.)
 * or decides to advance to the next step.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SupervisorEvaluateParams, SupervisorEvaluateResult } from "./protocol";
import { findClaudeBinary } from "./utils.js";

const DEFAULT_SYSTEM_PROMPT = `You are a workflow supervisor for MeldUI. An AI coding agent is working on a ticket step-by-step, and you are reviewing its latest output to decide what to do next.

Your #1 job is to keep the agent unblocked. You act as the human user — answering questions, making decisions, and approving actions so the agent can keep working.

CRITICAL RULE: If the agent asked ANY questions or requested ANY clarification, you MUST reply with answers. Unanswered questions always mean "reply", never "advance". Even if the step looks otherwise complete, answer the questions first.

You have two actions:
- "reply": Send a message back to the agent. Use this when:
  - The agent asked questions — answer ALL of them using the ticket context
  - The agent asked for confirmation or permission — approve it
  - The agent needs a decision — make one based on the ticket requirements
  - The agent is waiting for input before continuing
- "advance": Move to the next workflow step. Use this ONLY when ALL of these are true:
  - The agent has NOT asked any unanswered questions
  - The agent explicitly says the work is done OR the output clearly fulfills the step
  - There is nothing blocking the agent from moving on

When replying:
- Answer every question directly and concisely
- Make reasonable decisions based on the ticket context — don't defer back to the user
- Approve and confirm requests to proceed
- Do NOT ask your own questions — just answer and decide

Respond with JSON only:
{ "action": "reply", "message": "your response here", "reasoning": "why you chose this" }
or
{ "action": "advance", "reasoning": "why the step is complete" }`;

function buildUserMessage(params: SupervisorEvaluateParams): string {
  return `## Full Ticket Data
\`\`\`json
${params.ticketJson}
\`\`\`

## Current Step [${params.stepIndex + 1}]: ${params.stepName}
Prompt: ${params.stepPrompt}

## Agent's Latest Response
${params.workerResponse}`;
}

function parseResponse(text: string): SupervisorEvaluateResult {
  // Try to extract JSON from the response (model may wrap in markdown)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON found in response: ${text.slice(0, 200)}`);
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
  const systemPrompt = params.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const userMessage = buildUserMessage(params);
  const claudePath = findClaudeBinary();

  if (claudePath) {
    process.stderr.write(`[supervisor] Using claude binary: ${claudePath}\n`);
  } else {
    process.stderr.write(`[supervisor] No claude binary found, falling back to SDK auto-detect\n`);
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const agentQuery = query({
        prompt: userMessage,
        options: {
          model: params.model ?? "claude-haiku-4-5-20251001",
          maxTurns: 1,
          systemPrompt: systemPrompt,
          tools: [],
          allowedTools: [],
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          cwd: params.projectDir ?? process.cwd(),
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

      process.stderr.write(`[supervisor] Raw response: ${resultText.slice(0, 500)}\n`);
      return parseResponse(resultText);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[supervisor] attempt ${attempt + 1} failed: ${errMsg}\n`,
      );
      if (attempt === 0) {
        continue;
      }
      // Second attempt failed — return the error so Rust can see it
      return {
        action: "advance",
        reasoning: `Supervisor evaluation failed: ${errMsg}`,
      };
    }
  }

  // Unreachable, but satisfy TypeScript
  return { action: "advance", reasoning: "Supervisor evaluation failed" };
}
