import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BashSession } from './bashSession.js'
import { Logger } from '../utils/logger.js'

describe('BashSession with node-pty', () => {
  let session: BashSession
  const logger = new Logger()

  beforeEach(() => {
    session = new BashSession(logger, {
      timeout: 5000
    })
  })

  afterEach(async () => {
    if (session.alive) {
      await session.stop()
    }
  })

  it('should start and stop a bash session', async () => {
    await session.start()
    expect(session.alive).toBe(true)
    expect(session.pid).toBeDefined()
    
    await session.stop()
    expect(session.alive).toBe(false)
  })

  it('should execute a simple command', async () => {
    await session.start()
    
    const result = await session.exec('echo "Hello, World!"')
    
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Hello, World!')
  })

  it('should handle command failures', async () => {
    await session.start()
    
    const result = await session.exec('ls /nonexistent-directory-12345')
    
    expect(result.success).toBe(false)
    expect(result.exitCode).not.toBe(0)
  })

  it('should stream output in real-time', async () => {
    await session.start()
    
    const chunks: string[] = []
    const result = await session.exec('for i in 1 2 3; do echo "Line $i"; sleep 0.1; done', {
      onStdout: (chunk) => chunks.push(chunk)
    })
    
    expect(result.success).toBe(true)
    expect(chunks.length).toBeGreaterThan(0)
    expect(result.stdout).toContain('Line 1')
    expect(result.stdout).toContain('Line 2')
    expect(result.stdout).toContain('Line 3')
  })

  it('should maintain session state between commands', async () => {
    await session.start()
    
    // Set a variable
    await session.exec('TEST_VAR="persistent"')
    
    // Use the variable in another command
    const result = await session.exec('echo $TEST_VAR')
    
    expect(result.success).toBe(true)
    expect(result.stdout).toContain('persistent')
  })

  it('should handle working directory changes', async () => {
    await session.start()
    
    // Change directory
    await session.exec('cd /tmp')
    
    // Check current directory
    const result = await session.exec('pwd')
    
    expect(result.success).toBe(true)
    expect(result.stdout).toContain('/tmp')
  })

  it('should timeout long-running commands', async () => {
    const shortTimeoutSession = new BashSession(logger, {
      timeout: 1000 // 1 second
    })
    
    await shortTimeoutSession.start()
    
    try {
      await shortTimeoutSession.exec('sleep 5')
      expect.fail('Should have timed out')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('timed out')
    } finally {
      await shortTimeoutSession.stop()
    }
  })
})