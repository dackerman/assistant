import { z } from "zod";
import type { ToolDefinition } from "../toolExecutorService";
import type { BashSessionManager } from "../bashSessionManager";

const BashToolInputSchema = z.object({
  command: z.string().min(1, "Command is required"),
});

export type BashToolInput = z.infer<typeof BashToolInputSchema>;

export function createBashTool(
  sessionManager: BashSessionManager,
): ToolDefinition<BashToolInput> {
  return {
    name: "bash",
    description:
      "Execute bash commands in a persistent shell session. Use responsibly.",
    inputSchema: BashToolInputSchema,
    async *execute({ input, conversationId, logger }) {
      const session = await sessionManager.getSession(conversationId);
      const chunks: string[] = [];

      const result = await session.exec(input.command, {
        onStdout: (chunk) => {
          chunks.push(chunk);
          logger.debug("Bash tool stdout", { chunkLength: chunk.length });
        },
        onStderr: (chunk) => {
          logger.debug("Bash tool stderr", { chunkLength: chunk.length });
        },
        onError: (error) => {
          logger.error("Bash tool error", { error });
        },
      });

      const output = chunks.join("");

      if (!result.success) {
        yield { type: "error", error: result.error ?? "Command failed" } as const;
        return;
      }

      if (output) {
        yield { type: "chunk", chunk: output } as const;
      }

      yield { type: "result", output } as const;
    },
  };
}
