/**
 * Shared bot context for forum topic thread routing.
 * Stores the current message_thread_id so all handlers
 * can route messages to the correct topic.
 */

let currentThreadId: number | undefined = undefined;

export function setCurrentThreadId(threadId: number | undefined): void {
  currentThreadId = threadId;
}

export function getCurrentThreadId(): number | undefined {
  return currentThreadId;
}

/**
 * Helper to build message_thread_id option for Telegram API calls.
 * Returns empty object if not in a forum topic.
 */
export function threadIdOption(): { message_thread_id: number } | Record<string, never> {
  return currentThreadId ? { message_thread_id: currentThreadId } : {};
}
