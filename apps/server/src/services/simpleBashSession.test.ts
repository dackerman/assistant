import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SimpleBashSession } from './simpleBashSession'
import { Logger } from '../utils/logger'

describe('SimpleBashSession', () => {
  let session: SimpleBashSession
  let logger: Logger

  beforeEach(async () => {
    logger = new Logger({ service: 'SimpleBashSessionTest' })
    session = new SimpleBashSession(logger, {
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

  it('should execute simple commands and return clean output', async () => {
    const result = await session.exec('echo "Hello World"')

    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Hello World')
    expect(result.stderr).toBe('')
  })

  it('should capture exit codes correctly', async () => {
    const result = await session.exec(
      'ls /nonexistent-directory-that-does-not-exist 2>&1'
    )

    expect(result.success).toBe(false)
    expect(result.exitCode).toBeGreaterThan(0)
    expect(result.stdout).toContain('cannot access')
  })

  it('should maintain working directory state', async () => {
    // Change directory
    let result = await session.exec('cd /usr')
    expect(result.success).toBe(true)

    // Verify we're in /usr
    result = await session.exec('pwd')
    expect(result.success).toBe(true)
    expect(result.stdout).toBe('/usr')

    // Change to another directory
    result = await session.exec('cd /var')
    expect(result.success).toBe(true)

    // Verify we're in /var
    result = await session.exec('pwd')
    expect(result.success).toBe(true)
    expect(result.stdout).toBe('/var')
  })

  it('should maintain environment variables', async () => {
    // Set an environment variable
    let result = await session.exec('export TEST_VAR="test value"')
    expect(result.success).toBe(true)

    // Read the environment variable
    result = await session.exec('echo "$TEST_VAR"')
    expect(result.success).toBe(true)
    expect(result.stdout).toBe('test value')

    // Use it in another command
    result = await session.exec('echo "Value is: $TEST_VAR"')
    expect(result.success).toBe(true)
    expect(result.stdout).toBe('Value is: test value')
  })

  it('should handle pipes and shell features', async () => {
    const result = await session.exec('echo "hello world" | tr a-z A-Z')

    expect(result.success).toBe(true)
    expect(result.stdout).toBe('HELLO WORLD')
  })

  it('should handle command substitution', async () => {
    await session.exec('cd /tmp')
    const result = await session.exec('echo "Current directory: $(pwd)"')

    expect(result.success).toBe(true)
    expect(result.stdout).toBe('Current directory: /tmp')
  })

  it('should provide clean output without command echo', async () => {
    const result = await session.exec('date +"%Y-%m-%d"')

    expect(result.success).toBe(true)
    // Should be just the date, no command echo
    expect(result.stdout).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Should not contain the command itself
    expect(result.stdout).not.toContain('date')
  })

  it('should handle multiline output', async () => {
    const result = await session.exec('echo -e "line1\\nline2\\nline3"')

    expect(result.success).toBe(true)
    expect(result.stdout).toBe('line1\nline2\nline3')
  })

  it('should separate stdout and stderr', async () => {
    // Command that writes to both stdout and stderr
    const result = await session.exec(
      'echo "stdout text" && >&2 echo "stderr text"'
    )

    expect(result.success).toBe(true)
    expect(result.stdout).toBe('stdout text')
    expect(result.stderr).toBe('stderr text')
  })

  it('should timeout long-running commands', async () => {
    const shortSession = new SimpleBashSession(logger, {
      workingDirectory: '/tmp',
      timeout: 1000, // 1 second
    })
    await shortSession.start()

    try {
      const result = await shortSession.exec('sleep 5')
      expect(result.success).toBe(false)
      expect(result.error).toContain('timed out')
    } finally {
      await shortSession.stop()
    }
  })

  it('should handle special characters in commands', async () => {
    // Use single quotes to prevent variable expansion
    const result = await session.exec(
      "echo 'Test with $pecial & characters | > <'"
    )

    expect(result.success).toBe(true)
    expect(result.stdout).toBe('Test with $pecial & characters | > <')
  })

  it('should handle relative paths in cd', async () => {
    // Start in /tmp
    await session.exec('cd /tmp')

    // Create a test directory
    await session.exec('mkdir -p test/nested')

    // Navigate using relative paths
    let result = await session.exec('cd test')
    expect(result.success).toBe(true)

    result = await session.exec('pwd')
    expect(result.stdout).toBe('/tmp/test')

    // Go up one level
    result = await session.exec('cd ..')
    expect(result.success).toBe(true)

    result = await session.exec('pwd')
    expect(result.stdout).toBe('/tmp')

    // Clean up
    await session.exec('rm -rf test')
  })
})
