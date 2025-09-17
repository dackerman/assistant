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
    description: 'Test tool that echoes FAKE OUTPUT',
    inputSchema: TestToolInputSchema,
    async *execute({ input }: ToolExecutionContext<TestToolInput>) {
      const output = `FAKE OUTPUT: ${input.command}`
      const events: ToolStreamEvent[] = [
        { type: 'chunk', chunk: output },
        { type: 'result', output },
      ]
      for (const event of events) {
        yield event
      }
    },
  }
}
