import type Anthropic from "@anthropic-ai/sdk";
import type { DB } from "../db";
import { PromptService } from "../services/promptService";

type StreamEvent = Record<string, unknown>;

class StreamIterator {
  constructor(private readonly events: StreamEvent[]) {}

  async *[Symbol.asyncIterator]() {
    for (const event of this.events) {
      yield event;
    }
  }
}

class StubAnthropic {
  constructor(private readonly queue: StreamEvent[][]) {}

  messages = {
    create: async () => new StreamIterator(this.queue.shift() ?? []),
  };
}

export function createPromptServiceFixture(db: DB) {
  const streamQueue: StreamEvent[][] = [];
  const anthropicClient = new StubAnthropic(streamQueue) as unknown as Anthropic;
  const promptService = new PromptService(db as DB, { anthropicClient });

  return {
    promptService,
    enqueueStream(events: StreamEvent[]) {
      streamQueue.push(events);
    },
  };
}
