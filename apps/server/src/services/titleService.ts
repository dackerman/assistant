import Anthropic from '@anthropic-ai/sdk'
import { Logger } from '../utils/logger'

const DEFAULT_TITLE_MODEL =
  process.env.TITLE_MODEL || 'claude-haiku-3-5-20241022'

const SYSTEM_PROMPT = `You are a helpful assistant that creates concise conversation titles.
- Keep titles to 6 words or fewer
- Title case the result
- Do not include quotation marks or punctuation at the end
- Respond with the title only`

export class TitleService {
  private logger: Logger

  constructor(
    private anthropic: Anthropic,
    logger?: Logger
  ) {
    this.logger = logger ?? new Logger({ service: 'TitleService' })
  }

  async generateTitleFromMessage(message: string): Promise<string | null> {
    const trimmed = message.trim()
    if (!trimmed) return null

    try {
      const response = await this.anthropic.messages.create({
        model: DEFAULT_TITLE_MODEL,
        max_tokens: 40,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Suggest a short conversation title for the following user request. Respond with the title only.\n\nUser message: ${trimmed}`,
              },
            ],
          },
        ],
      })

      const textContent = response.content
        .filter(part => part.type === 'text')
        .map(part => {
          if (part.type === 'text') return part.text
          return ''
        })
        .join(' ')
        .trim()

      const cleaned = this.sanitizeTitle(textContent)
      if (!cleaned) return null

      this.logger.debug('Generated conversation title', {
        title: cleaned,
      })

      return cleaned
    } catch (error) {
      this.logger.error('Failed to generate conversation title', error)
      return null
    }
  }

  private sanitizeTitle(raw: string): string | null {
    if (!raw) return null

    let title = raw.trim()

    if (!title) return null

    // Remove surrounding quotes if present
    if (
      (title.startsWith('"') && title.endsWith('"')) ||
      (title.startsWith("'") && title.endsWith("'"))
    ) {
      title = title.slice(1, -1).trim()
    }

    // Remove trailing punctuation
    title = title.replace(/[.!?]+$/u, '').trim()

    if (!title) return null

    // Limit length to a reasonable size
    if (title.length > 80) {
      title = `${title.slice(0, 77).trim()}…`
    }

    // Capitalize to Title Case (basic implementation)
    title = title
      .split(/\s+/u)
      .map(word => {
        if (word.length === 0) return word
        const first = word.charAt(0)
        return first.toUpperCase() + word.slice(1).toLowerCase()
      })
      .join(' ')

    return title
  }
}
