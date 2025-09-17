import { z } from 'zod'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolStreamEvent,
} from '../../services/toolExecutorService'

const TestToolInputSchema = z.object({
  command: z.string().min(1, 'Command is required'),
})

type TestToolInput = z.infer<typeof TestToolInputSchema>

export function createTestTool(): ToolDefinition<TestToolInput> {
  return {
    name: 'bash',
    description: 'Test tool that echoes the input three times',
    inputSchema: TestToolInputSchema,
    async *execute({ input }: ToolExecutionContext<TestToolInput>) {
      const chunks = [`testing too`, `l output.\nthi`, `s is just a test!`];
      const events: ToolStreamEvent[] = [...chunks.map(chunk => ({ type: 'chunk', chunk })) as ToolStreamEvent[]];
      events.push({ type: 'result', output: chunks.join('') });
      for (const event of events) {
        yield event
      }
    },
  }
}
