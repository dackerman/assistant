import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BashSession } from './bashSession'
import { Logger } from '../utils/logger'

describe('BashSession', () => {
  let session: BashSession
  let logger: Logger

  beforeEach(async () => {
    logger = new Logger({ service: 'BashSessionTest' })
    session = new BashSession(logger, {
      workingDirectory: '/tmp',
      timeout: 5000,
    })
    await session.start()
  })

  afterEach(async () => {
    if (session) {
      await session.stop()
    }
  })

  it('should execute simple commands and return output', async () => {
    const result = await session.exec('echo "Hello World"')

    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Hello World')
    expect(result.error).toBeUndefined()
  })

  it('should capture the correct exit code for failed commands', async () => {
    const result = await session.exec(
      'ls /nonexistent-directory-that-does-not-exist'
    )

    expect(result.success).toBe(false)
    expect(result.exitCode).toBeGreaterThan(0)
    expect(result.stdout).toContain('cannot access')
    expect(result.error).toBeDefined()
  })

  it('should handle commands with special characters and formatting', async () => {
    const result = await session.exec('date +"%Y-%m-%d %H:%M:%S"')

    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    // Check that it's a date format (YYYY-MM-DD HH:MM:SS)
    expect(result.stdout).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('should execute multiple commands sequentially', async () => {
    // First command - create a file
    let result = await session.exec('echo "test content" > /tmp/test-file.txt')
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)

    // Second command - read the file
    result = await session.exec('cat /tmp/test-file.txt')
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('test content')

    // Third command - remove the file
    result = await session.exec('rm /tmp/test-file.txt')
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)

    // Fourth command - verify file is gone
    result = await session.exec('ls /tmp/test-file.txt')
    expect(result.success).toBe(false)
    expect(result.exitCode).toBeGreaterThan(0)
  })

  it('should maintain working directory state', async () => {
    // Change directory
    let result = await session.exec('cd /usr')
    expect(result.success).toBe(true)

    // Check we're in /usr
    result = await session.exec('pwd')
    expect(result.success).toBe(true)
    expect(result.stdout).toBe('/usr')
  })

  it('should handle environment variables', async () => {
    // Set an environment variable
    let result = await session.exec('export TEST_VAR="test value"')
    expect(result.success).toBe(true)

    // Read the environment variable
    result = await session.exec('echo "$TEST_VAR"')
    expect(result.success).toBe(true)
    expect(result.stdout).toBe('test value')
  })

  it('should handle multiline output correctly', async () => {
    const result = await session.exec('echo -e "line1\\nline2\\nline3"')

    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('line1\nline2\nline3')
  })

  it('should handle commands with pipes', async () => {
    const result = await session.exec('echo "hello world" | tr a-z A-Z')

    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('HELLO WORLD')
  })

  it('should handle command substitution', async () => {
    const result = await session.exec('echo "Current directory: $(pwd)"')

    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Current directory: /tmp')
  })

  it('should not show EXIT_CODE in output', async () => {
    const result = await session.exec('echo "test"')

    expect(result.success).toBe(true)
    expect(result.stdout).toBe('test')
    // Make sure EXIT_CODE doesn't appear in the output
    expect(result.stdout).not.toContain('EXIT_CODE')
  })

  it('should handle streaming callbacks', async () => {
    const chunks: string[] = []

    const result = await session.exec(
      'echo "First line"; sleep 0.1; echo "Second line"',
      {
        onStdout: chunk => {
          chunks.push(chunk)
        },
      }
    )

    expect(result.success).toBe(true)
    expect(chunks.length).toBeGreaterThan(0)
    // The full output should be in the result
    expect(result.stdout).toContain('First line')
    expect(result.stdout).toContain('Second line')
  })

  it('should timeout long running commands', async () => {
    const shortTimeoutLogger = new Logger({
      service: 'BashSessionTest-Timeout',
    })
    const shortTimeoutSession = new BashSession(shortTimeoutLogger, {
      workingDirectory: '/tmp',
      timeout: 1000, // 1 second timeout
    })
    await shortTimeoutSession.start()

    try {
      await expect(shortTimeoutSession.exec('sleep 5')).rejects.toThrow(
        /timeout/i
      )
    } finally {
      await shortTimeoutSession.stop()
    }
  })
})
