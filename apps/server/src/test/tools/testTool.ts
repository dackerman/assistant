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
    description: 'Test tool that emits chunked output',
    inputSchema: TestToolInputSchema,
    async *execute({ input }: ToolExecutionContext<TestToolInput>) {
      const chunks = ['testing tool output.\n', 'this is just ', 'a test!']
      for (const chunk of chunks) {
        yield { type: 'chunk', chunk } as ToolStreamEvent
      }
      yield { type: 'result', output: chunks.join('') } as ToolStreamEvent
    },
  }
}
