import { generateUUIDv7 } from "../domain/common/id.js";

export type TaskEventType =
  | "task_started"
  | "step_started"
  | "step_progress"
  | "step_completed"
  | "step_failed"
  | "artifact_emitted"
  | "task_completed"
  | "task_failed"
  | "token_chunk";

export interface TaskStreamEvent {
  readonly eventId: string;
  readonly eventType: TaskEventType;
  readonly taskId: string;
  readonly timestamp: string;
  readonly payload: Record<string, unknown>;
}

export type TaskEventListener = (event: TaskStreamEvent) => void;

export class TaskEventBroadcaster {
  private subscribers = new Map<string, Set<TaskEventListener>>();
  private recentEventBuffer = new Map<string, TaskStreamEvent[]>();
  private readonly maxBufferSize = 20;

  /**
   * Subscribes a listener to events for a specific taskId.
   * Returns an unsubscribe function to prevent memory leaks.
   */
  public subscribe(
    taskId: string,
    listener: TaskEventListener,
    replayRecent = true
  ): () => void {
    if (!this.subscribers.has(taskId)) {
      this.subscribers.set(taskId, new Set());
    }
    this.subscribers.get(taskId)!.add(listener);

    // Replay recent buffered events to new subscribers
    if (replayRecent && this.recentEventBuffer.has(taskId)) {
      const buffer = this.recentEventBuffer.get(taskId)!;
      for (const ev of buffer) {
        listener(ev);
      }
    }

    return () => {
      const set = this.subscribers.get(taskId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.subscribers.delete(taskId);
          this.recentEventBuffer.delete(taskId);
        }
      }
    };
  }

  /**
   * Broadcasts a typed event to all active subscribers for the given task.
   */
  public broadcast(params: {
    readonly taskId: string;
    readonly eventType: TaskEventType;
    readonly payload?: Record<string, unknown>;
  }): TaskStreamEvent {
    const event: TaskStreamEvent = {
      eventId: generateUUIDv7(),
      eventType: params.eventType,
      taskId: params.taskId,
      timestamp: new Date().toISOString(),
      payload: params.payload || {},
    };

    // Buffer event for future subscribers
    if (!this.recentEventBuffer.has(params.taskId)) {
      this.recentEventBuffer.set(params.taskId, []);
    }
    const buf = this.recentEventBuffer.get(params.taskId)!;
    buf.push(event);
    if (buf.length > this.maxBufferSize) {
      buf.shift();
    }

    // Emit to active listeners
    const listeners = this.subscribers.get(params.taskId);
    if (listeners && listeners.size > 0) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (err) {
          console.error(`[Broadcaster] Error in event listener for task ${params.taskId}:`, err);
        }
      }
    }

    return event;
  }

  public getSubscriberCount(taskId: string): number {
    return this.subscribers.get(taskId)?.size || 0;
  }

  public clearTask(taskId: string): void {
    this.subscribers.delete(taskId);
    this.recentEventBuffer.delete(taskId);
  }
}

export const taskEventBroadcaster = new TaskEventBroadcaster();
