import type Anthropic from "@anthropic-ai/sdk";
import { type DB, prompts } from "../db/index.js";
import type { Logger } from "../utils/logger.js";

/**
 * PromptService handles making a call to an LLM and persisting it to the database.
 * It generally persists the requests and responses directly into the DB rather than
 * abstracting it much. The database records are mainly for fault tolerance and robustness
 * to mutliple viewing clients and disconnects.
 *
 * Note that this class only handles a single prompt to an LLM, not an entire conversation. It's
 * indifferent to the mechanism by which the "previous messages" data is provided to the context.
 *
 * It does, however, handle tool calls and re-prompting with the results in a loop. So this represents
 * the entire state machine for handling a "response".
 *
 * Higher level classes are expected to use this class for individual prompts
 */
export class PromptService {
  private readonly client: Anthropic;
  private readonly db: DB;
  private readonly logger: Logger;

  private constructor(client: Anthropic, db: DB, logger: Logger) {
    this.client = client;
    this.db = db;
    this.logger = logger.child({ service: "PromptService" });
  }

  async prompt(messages: Anthropic.Messages.Message[]) {
    const request = {
      model: "claude-4-sonnet-20250514",
      max_tokens: 50000,
      stream: true,
      messages,
    };
    const stream = await this.client.messages.create(request);
    this.db.insert(prompts, {
      request,
    });

    for await (const event of stream) {
      this.logger.info("Stream event", { event });
    }

    return stream;
  }
}
