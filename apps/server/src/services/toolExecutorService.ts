import { type ChildProcess, spawn } from "node:child_process";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { type ToolCall, prompts, toolCalls } from "../db/schema.js";
import { StreamingStateMachine } from "../streaming/stateMachine.js";
import { SessionManager } from "./sessionManager.js";
import type { ToolResult } from "./toolSession.js";

export interface ToolExecutorConfig {
  maxRetries: number;
  timeoutSeconds: number;
  heartbeatInterval: number;
  staleCheckInterval: number;
  shutdownGracePeriod: number;
}

export type BroadcastFunction = (
  conversationId: number,
  payload:
    | {
        type: "tool_call_started";
        promptId: number;
        toolCallId: number;
        toolName: string;
        parameters: Record<string, unknown>;
      }
    | {
        type: "tool_call_output_delta";
        promptId: number;
        toolCallId: number;
        stream: "stdout" | "stderr";
        delta: string;
      }
    | {
        type: "tool_call_completed";
        promptId: number;
        toolCallId: number;
        exitCode: number;
      }
    | {
        type: "tool_call_error";
        promptId: number;
        toolCallId: number;
        error: string;
      },
) => void;

export class ToolExecutorService {
  private runningProcesses = new Map<number, ChildProcess>();
  private heartbeatTimer?: NodeJS.Timeout;
  private staleCheckTimer?: NodeJS.Timeout;
  private isShuttingDown = false;
  private sessionManager = new SessionManager();
  private config: ToolExecutorConfig;
  private broadcast?: BroadcastFunction;

  constructor(
    config: Partial<ToolExecutorConfig> = {},
    broadcast?: BroadcastFunction,
  ) {
    this.config = {
      maxRetries: 3,
      timeoutSeconds: 300,
      heartbeatInterval: 30000,
      staleCheckInterval: 60000,
      shutdownGracePeriod: 5000,
      ...config,
    };
    this.broadcast = broadcast;
  }

  async initialize(): Promise<void> {
    // Cleanup orphaned processes on startup
    await this.cleanupOrphanedProcesses();

    // Start heartbeat and stale check timers
    this.startHeartbeat();
    this.startStaleCheck();

    // Setup graceful shutdown handlers
    process.on("SIGTERM", () => this.gracefulShutdown());
    process.on("SIGINT", () => this.gracefulShutdown());
  }

  async executeToolCall(toolCallId: number): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error(
        "Service is shutting down, cannot execute new tool calls",
      );
    }

    const toolCall = await db.query.toolCalls.findFirst({
      where: eq(toolCalls.id, toolCallId),
    });

    if (!toolCall) {
      throw new Error(`Tool call ${toolCallId} not found`);
    }

    if (toolCall.state !== "created") {
      throw new Error(`Tool call ${toolCallId} is not in created state`);
    }

    try {
      await this.executeWithSessionSupport(toolCall);
    } catch (error) {
      await this.markToolCallFailed(toolCallId, error as Error);
      throw error;
    }
  }

  private async executeWithSessionSupport(toolCall: ToolCall): Promise<void> {
    // Mark as running first
    await db
      .update(toolCalls)
      .set({
        state: "running",
        startedAt: new Date(),
        lastHeartbeat: new Date(),
      })
      .where(eq(toolCalls.id, toolCall.id));

    try {
      // Get the conversation ID from the tool call
      const conversationId = await this.getConversationIdForToolCall(toolCall);

      // Broadcast tool call started
      if (this.broadcast) {
        this.broadcast(conversationId, {
          type: "tool_call_started",
          promptId: toolCall.promptId,
          toolCallId: toolCall.id,
          toolName: toolCall.toolName,
          parameters: toolCall.request as Record<string, unknown>,
        });
      }

      // Use streaming execution for bash, fallback to regular for others
      if (toolCall.toolName === "bash") {
        await this.executeStreamingBash(toolCall, conversationId);
      } else {
        // Get or create session for this tool
        const session = await this.sessionManager.getOrCreateSession(
          conversationId,
          toolCall.toolName,
        );

        // Execute the tool call in the session
        const result = await session.execute(toolCall);

        // Update database with results
        if (result.success) {
          await db
            .update(toolCalls)
            .set({
              state: "complete",
              response: {
                output: result.output,
                metadata: result.metadata,
              },
              outputStream: result.output,
            })
            .where(eq(toolCalls.id, toolCall.id));

          // Broadcast completion for non-streaming tools
          if (this.broadcast) {
            this.broadcast(conversationId, {
              type: "tool_call_completed",
              promptId: toolCall.promptId,
              toolCallId: toolCall.id,
              exitCode: 0,
            });
          }

          // Check if all tools for this prompt are complete
          await this.checkAndHandlePromptCompletion(toolCall.promptId);
        } else {
          throw new Error(result.error || "Tool execution failed");
        }
      }
    } catch (error) {
      // Mark as failed
      await db
        .update(toolCalls)
        .set({
          state: "error",
          error: error instanceof Error ? error.message : String(error),
        })
        .where(eq(toolCalls.id, toolCall.id));

      // Broadcast error
      if (this.broadcast) {
        const conversationId =
          await this.getConversationIdForToolCall(toolCall);
        this.broadcast(conversationId, {
          type: "tool_call_error",
          promptId: toolCall.promptId,
          toolCallId: toolCall.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      throw error;
    }
  }

  private async getConversationIdForToolCall(
    toolCall: ToolCall,
  ): Promise<number> {
    // Get the prompt to find the conversation ID
    const prompt = await db.query.prompts.findFirst({
      where: (prompts, { eq }) => eq(prompts.id, toolCall.promptId),
      columns: { conversationId: true },
    });

    if (!prompt) {
      throw new Error(`Prompt ${toolCall.promptId} not found`);
    }

    return prompt.conversationId;
  }

  private async executeStreamingBash(
    toolCall: ToolCall,
    conversationId: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Extract command from tool call request
      const command = (toolCall.request as { command?: string }).command;
      if (!command) {
        reject(new Error("No command provided for bash tool call"));
        return;
      }

      // Spawn bash process
      const bashProcess = spawn("bash", ["-c", command], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          // Set basic environment
          HOME: process.env.HOME || "/tmp",
        },
      });

      let stdoutBuffer = "";
      let stderrBuffer = "";

      // Handle stdout streaming
      bashProcess.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdoutBuffer += chunk;

        // Broadcast the output delta
        if (this.broadcast) {
          this.broadcast(conversationId, {
            type: "tool_call_output_delta",
            promptId: toolCall.promptId,
            toolCallId: toolCall.id,
            stream: "stdout",
            delta: chunk,
          });
        }
      });

      // Handle stderr streaming
      bashProcess.stderr?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderrBuffer += chunk;

        // Broadcast the error output delta
        if (this.broadcast) {
          this.broadcast(conversationId, {
            type: "tool_call_output_delta",
            promptId: toolCall.promptId,
            toolCallId: toolCall.id,
            stream: "stderr",
            delta: chunk,
          });
        }
      });

      // Handle process completion
      bashProcess.on("close", async (code, signal) => {
        try {
          // Combine stdout and stderr for database storage
          const combinedOutput =
            stdoutBuffer + (stderrBuffer ? `\nSTDERR:\n${stderrBuffer}` : "");

          // Update database with results
          await db
            .update(toolCalls)
            .set({
              state: "complete",
              response: {
                output: combinedOutput,
                exitCode: code,
                signal: signal,
                stdout: stdoutBuffer,
                stderr: stderrBuffer,
              },
              outputStream: combinedOutput,
            })
            .where(eq(toolCalls.id, toolCall.id));

          // Broadcast completion
          if (this.broadcast) {
            this.broadcast(conversationId, {
              type: "tool_call_completed",
              promptId: toolCall.promptId,
              toolCallId: toolCall.id,
              exitCode: code || 0,
            });
          }

          // Check if all tools for this prompt are complete
          await this.checkAndHandlePromptCompletion(toolCall.promptId);

          resolve();
        } catch (error) {
          reject(error);
        }
      });

      // Handle process errors
      bashProcess.on("error", async (error) => {
        try {
          // Update database with error
          await db
            .update(toolCalls)
            .set({
              state: "error",
              error: error.message,
            })
            .where(eq(toolCalls.id, toolCall.id));

          // Broadcast error
          if (this.broadcast) {
            this.broadcast(conversationId, {
              type: "tool_call_error",
              promptId: toolCall.promptId,
              toolCallId: toolCall.id,
              error: error.message,
            });
          }

          // Check if all tools for this prompt are complete (even on error)
          await this.checkAndHandlePromptCompletion(toolCall.promptId);

          reject(error);
        } catch (dbError) {
          reject(dbError);
        }
      });

      // Store the process for potential cleanup
      this.runningProcesses.set(toolCall.id, bashProcess);

      // Remove from running processes when done
      bashProcess.on("exit", () => {
        this.runningProcesses.delete(toolCall.id);
      });
    });
  }

  private async executeWithRetry(toolCall: ToolCall): Promise<void> {
    const maxRetries = toolCall.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Update retry count
          await db
            .update(toolCalls)
            .set({ retryCount: attempt })
            .where(eq(toolCalls.id, toolCall.id));
        }

        await this.executeSingle(toolCall);
        return; // Success!
      } catch (error) {
        lastError = error as Error;

        // If it's the last attempt or a non-retryable error, give up
        if (attempt >= maxRetries || !this.isRetryableError(error as Error)) {
          break;
        }

        // Exponential backoff
        const backoffMs = Math.min(1000 * 2 ** attempt, 30000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError;
  }

  private async executeSingle(toolCall: ToolCall): Promise<void> {
    const startTime = new Date();
    const timeoutTime = new Date(
      startTime.getTime() + toolCall.timeoutSeconds * 1000,
    );

    // Mark as running and set initial state
    await db
      .update(toolCalls)
      .set({
        state: "running",
        startedAt: startTime,
        timeoutAt: timeoutTime,
        lastHeartbeat: startTime,
      })
      .where(eq(toolCalls.id, toolCall.id));

    // Create the child process
    const process = this.createToolProcess(toolCall);

    // Update with PID once process starts
    if (process.pid) {
      this.runningProcesses.set(process.pid, process);
      await db
        .update(toolCalls)
        .set({ pid: process.pid })
        .where(eq(toolCalls.id, toolCall.id));
    }

    // Setup process handlers
    return new Promise((resolve, reject) => {
      let output = "";
      let hasResolved = false;

      const cleanup = () => {
        if (process.pid) {
          this.runningProcesses.delete(process.pid);
        }
      };

      const resolveOnce = (result?: undefined) => {
        if (hasResolved) return;
        hasResolved = true;
        cleanup();
        resolve(result);
      };

      const rejectOnce = (error: Error) => {
        if (hasResolved) return;
        hasResolved = true;
        cleanup();
        reject(error);
      };

      // Handle process output
      process.stdout?.on("data", async (data) => {
        output += data.toString();
        // Update output stream periodically
        await this.updateHeartbeat(toolCall.id, output);
      });

      process.stderr?.on("data", async (data) => {
        output += data.toString();
        await this.updateHeartbeat(toolCall.id, output);
      });

      // Handle process completion
      process.on("close", async (code) => {
        try {
          if (code === 0) {
            await db
              .update(toolCalls)
              .set({
                state: "complete",
                response: { output, exitCode: code },
                outputStream: output,
              })
              .where(eq(toolCalls.id, toolCall.id));
            resolveOnce();
          } else {
            throw new Error(`Process exited with code ${code}: ${output}`);
          }
        } catch (error) {
          rejectOnce(error as Error);
        }
      });

      process.on("error", (error) => {
        rejectOnce(new Error(`Process error: ${error.message}`));
      });

      // Setup timeout
      const timeoutHandle = setTimeout(() => {
        if (!hasResolved) {
          process.kill("SIGTERM");
          setTimeout(() => {
            if (!process.killed) {
              process.kill("SIGKILL");
            }
          }, 5000);
          rejectOnce(
            new Error(
              `Tool execution timed out after ${toolCall.timeoutSeconds} seconds`,
            ),
          );
        }
      }, toolCall.timeoutSeconds * 1000);

      // Cleanup timeout on resolution
      process.on("close", () => clearTimeout(timeoutHandle));
    });
  }

  private createToolProcess(toolCall: ToolCall): ChildProcess {
    const request = toolCall.request as { command: string };
    const toolName = toolCall.toolName;

    // For now, handle bash tool calls - extend for other tools later
    if (toolName === "bash") {
      return spawn("bash", ["-c", request.command], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });
    }

    throw new Error(`Unsupported tool: ${toolName}`);
  }

  private async updateHeartbeat(
    toolCallId: number,
    outputStream?: string,
  ): Promise<void> {
    const updates: { lastHeartbeat: Date; outputStream?: string } = {
      lastHeartbeat: new Date(),
    };
    if (outputStream !== undefined) {
      updates.outputStream = outputStream;
    }

    await db.update(toolCalls).set(updates).where(eq(toolCalls.id, toolCallId));
  }

  private async markToolCallFailed(
    toolCallId: number,
    error: Error,
  ): Promise<void> {
    await db
      .update(toolCalls)
      .set({
        state: "error",
        error: error.message,
      })
      .where(eq(toolCalls.id, toolCallId));
  }

  private isRetryableError(error: Error): boolean {
    // Define which errors are retryable
    const retryablePatterns = [
      /ECONNRESET/,
      /ETIMEDOUT/,
      /ENOTFOUND/,
      /temporary failure/i,
    ];

    return retryablePatterns.some((pattern) => pattern.test(error.message));
  }

  private async cleanupOrphanedProcesses(): Promise<void> {
    // Find all running tool calls
    const runningCalls = await db.query.toolCalls.findMany({
      where: eq(toolCalls.state, "running"),
    });

    for (const call of runningCalls) {
      if (call.pid) {
        // Check if process is still alive
        const isAlive = await this.isProcessAlive(call.pid);
        if (!isAlive) {
          // Process is dead, mark as error
          await db
            .update(toolCalls)
            .set({
              state: "error",
              error: "Process terminated unexpectedly (orphaned on startup)",
            })
            .where(eq(toolCalls.id, call.id));
        }
      } else {
        // No PID recorded, likely failed to start
        await db
          .update(toolCalls)
          .set({
            state: "error",
            error: "Process failed to start (no PID recorded)",
          })
          .where(eq(toolCalls.id, call.id));
      }
    }
  }

  private async isProcessAlive(pid: number): Promise<boolean> {
    try {
      // On Unix systems, kill(pid, 0) checks if process exists
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      // Update heartbeat for all running processes we're managing
      const runningPids = Array.from(this.runningProcesses.keys());

      for (const pid of runningPids) {
        const calls = await db.query.toolCalls.findMany({
          where: and(eq(toolCalls.pid, pid), eq(toolCalls.state, "running")),
        });

        for (const call of calls) {
          await this.updateHeartbeat(call.id);
        }
      }
    }, this.config.heartbeatInterval);
  }

  private startStaleCheck(): void {
    this.staleCheckTimer = setInterval(async () => {
      const staleThreshold = new Date(
        Date.now() - this.config.heartbeatInterval * 3,
      );

      // Find stale processes (no heartbeat for 3x heartbeat interval)
      const staleCalls = await db.query.toolCalls.findMany({
        where: and(
          eq(toolCalls.state, "running"),
          or(
            lt(toolCalls.lastHeartbeat, staleThreshold),
            isNull(toolCalls.lastHeartbeat),
          ),
        ),
      });

      for (const call of staleCalls) {
        if (call.pid) {
          const isAlive = await this.isProcessAlive(call.pid);
          if (!isAlive) {
            // Process is dead, mark as error
            await db
              .update(toolCalls)
              .set({
                state: "error",
                error: "Process terminated unexpectedly (detected as stale)",
              })
              .where(eq(toolCalls.id, call.id));

            // Clean up from our tracking
            this.runningProcesses.delete(call.pid);
          }
        }
      }

      // Also check for timed out processes
      const now = new Date();
      const timedOutCalls = await db.query.toolCalls.findMany({
        where: and(
          eq(toolCalls.state, "running"),
          lt(toolCalls.timeoutAt, now),
        ),
      });

      for (const call of timedOutCalls) {
        if (call.pid) {
          const process = this.runningProcesses.get(call.pid);
          if (process) {
            // Kill the process
            process.kill("SIGTERM");
            setTimeout(() => {
              if (!process.killed) {
                process.kill("SIGKILL");
              }
            }, 5000);
          }

          await db
            .update(toolCalls)
            .set({
              state: "error",
              error: `Tool execution timed out after ${call.timeoutSeconds} seconds`,
            })
            .where(eq(toolCalls.id, call.id));

          this.runningProcesses.delete(call.pid);
        }
      }
    }, this.config.staleCheckInterval);
  }

  private async gracefulShutdown(): Promise<void> {
    console.log("Starting graceful shutdown of ToolExecutorService...");
    this.isShuttingDown = true;

    // Clear timers
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
    }

    // Cleanup all sessions
    await this.sessionManager.cleanupAllSessions();

    // Give running processes time to complete
    const runningPids = Array.from(this.runningProcesses.keys());
    if (runningPids.length > 0) {
      console.log(`Waiting for ${runningPids.length} processes to complete...`);

      await new Promise((resolve) => {
        setTimeout(resolve, this.config.shutdownGracePeriod);
      });

      // Kill any remaining processes
      for (const pid of this.runningProcesses.keys()) {
        const process = this.runningProcesses.get(pid);
        if (process && !process.killed) {
          console.log(`Terminating process ${pid}...`);
          process.kill("SIGTERM");

          // Force kill after 5 seconds
          setTimeout(() => {
            if (!process.killed) {
              process.kill("SIGKILL");
            }
          }, 5000);
        }
      }

      // Mark remaining running calls as canceled
      const stillRunning = await db.query.toolCalls.findMany({
        where: eq(toolCalls.state, "running"),
      });

      for (const call of stillRunning) {
        if (call.pid && this.runningProcesses.has(call.pid)) {
          await db
            .update(toolCalls)
            .set({
              state: "canceled",
              error: "Process terminated due to service shutdown",
            })
            .where(eq(toolCalls.id, call.id));
        }
      }
    }

    console.log("ToolExecutorService shutdown complete");
  }

  async getExecutionStatus(toolCallId: number): Promise<{
    state: string;
    startedAt: Date | null;
    lastHeartbeat: Date | null;
    outputStream: string | null;
    retryCount: number;
    error: string | null;
  } | null> {
    const toolCall = await db.query.toolCalls.findFirst({
      where: eq(toolCalls.id, toolCallId),
      columns: {
        state: true,
        startedAt: true,
        lastHeartbeat: true,
        outputStream: true,
        retryCount: true,
        error: true,
      },
    });

    return toolCall || null;
  }

  async cancelExecution(toolCallId: number): Promise<void> {
    const toolCall = await db.query.toolCalls.findFirst({
      where: eq(toolCalls.id, toolCallId),
    });

    if (!toolCall) {
      throw new Error(`Tool call ${toolCallId} not found`);
    }

    if (toolCall.state !== "running") {
      throw new Error(`Tool call ${toolCallId} is not running`);
    }

    if (toolCall.pid) {
      const process = this.runningProcesses.get(toolCall.pid);
      if (process) {
        process.kill("SIGTERM");
        setTimeout(() => {
          if (!process.killed) {
            process.kill("SIGKILL");
          }
        }, 5000);
      }
    }

    await db
      .update(toolCalls)
      .set({
        state: "canceled",
        error: "Execution canceled by user",
      })
      .where(eq(toolCalls.id, toolCallId));
  }

  /**
   * Check if all tools for a prompt are complete and handle completion
   */
  private async checkAndHandlePromptCompletion(
    promptId: number,
  ): Promise<void> {
    try {
      // Get all tool calls for this prompt
      const allTools = await db.query.toolCalls.findMany({
        where: eq(toolCalls.promptId, promptId),
      });

      if (allTools.length === 0) {
        return; // No tools to check
      }

      // Check if all tools are complete (success, error, or canceled)
      const pendingTools = allTools.filter(
        (tool) => tool.state === "created" || tool.state === "running",
      );

      if (pendingTools.length === 0) {
        // All tools are complete - handle completion
        const stateMachine = new StreamingStateMachine(promptId);

        // Check tool completion status
        const { allComplete } = await stateMachine.checkToolCompletion();

        if (allComplete) {
          // Continue after tools and complete the prompt
          const continueResult = await stateMachine.continueAfterTools();

          if (continueResult.status === "ready") {
            // Complete the prompt to mark message as complete
            await stateMachine.completePrompt();
          }
        }
      }
    } catch (error) {
      console.error(
        `Failed to check tool completion for prompt ${promptId}:`,
        error,
      );
    }
  }
}
