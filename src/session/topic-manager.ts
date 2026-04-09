import { SessionInfo } from "../settings/manager.js";
import { opencodeClient } from "../opencode/client.js";
import { getCurrentProject, setCurrentProject } from "../settings/manager.js";
import { config } from "../config.js";
import { ingestSessionInfoForCache } from "./cache-manager.js";
import { logger } from "../utils/logger.js";
import fs from "node:fs/promises";
import path from "node:path";
import { getRuntimePaths } from "../runtime/paths.js";

/**
 * Maps forum topics to OpenCode sessions.
 * Each topic in a Telegram group gets its own dedicated OpenCode session.
 *
 * Storage format: { "chatId:topicId": SessionInfo }
 */

interface TopicSessionMap {
  [key: string]: SessionInfo;
}

let topicSessions: TopicSessionMap = {};

function makeKey(chatId: number, topicId: number): string {
  return `${chatId}:${topicId}`;
}

function getTopicSessionsFilePath(): string {
  const runtimePaths = getRuntimePaths();
  return path.join(path.dirname(runtimePaths.settingsFilePath), "topic-sessions.json");
}

export async function loadTopicSessions(): Promise<void> {
  try {
    const content = await fs.readFile(getTopicSessionsFilePath(), "utf-8");
    topicSessions = JSON.parse(content) as TopicSessionMap;
    logger.info(`[TopicManager] Loaded ${Object.keys(topicSessions).length} topic-session mappings`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error("[TopicManager] Error loading topic sessions:", error);
    }
    topicSessions = {};
  }
}

async function saveTopicSessions(): Promise<void> {
  try {
    const filePath = getTopicSessionsFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(topicSessions, null, 2));
  } catch (err) {
    logger.error("[TopicManager] Error saving topic sessions:", err);
  }
}

export function getSessionForTopic(chatId: number, topicId: number): SessionInfo | null {
  const key = makeKey(chatId, topicId);
  return topicSessions[key] ?? null;
}

export function setSessionForTopic(
  chatId: number,
  topicId: number,
  session: SessionInfo,
): void {
  const key = makeKey(chatId, topicId);
  topicSessions[key] = session;
  void saveTopicSessions();
}

export function removeSessionForTopic(chatId: number, topicId: number): SessionInfo | null {
  const key = makeKey(chatId, topicId);
  const session = topicSessions[key] ?? null;
  delete topicSessions[key];
  void saveTopicSessions();
  return session;
}

export function getAllTopicSessions(chatId?: number): Array<{ chatId: number; topicId: number; session: SessionInfo }> {
  return Object.entries(topicSessions)
    .map(([key, session]) => {
      const [cId, tId] = key.split(":").map(Number);
      return { chatId: cId, topicId: tId, session };
    })
    .filter((entry) => chatId === undefined || entry.chatId === chatId);
}

/**
 * Auto-create a new OpenCode session for a forum topic.
 * Uses the topic name (if available) as the session title.
 */
export async function autoCreateSessionForTopic(
  chatId: number,
  topicId: number,
  topicName?: string,
): Promise<SessionInfo | null> {
  let currentProject = getCurrentProject();
  if (!currentProject && config.opencode.defaultProjectDir) {
    const defaultDir = config.opencode.defaultProjectDir;
    const projectName = defaultDir.split("/").filter(Boolean).pop() || "default";
    currentProject = { id: projectName, worktree: defaultDir, name: projectName };
    setCurrentProject(currentProject);
    logger.info(`[TopicManager] Auto-selected default project: ${defaultDir}`);
  }
  if (!currentProject) {
    logger.warn("[TopicManager] Cannot auto-create session: no project selected");
    return null;
  }

  try {
    const { data: session, error } = await opencodeClient.session.create({
      directory: currentProject.worktree,
    });

    if (error || !session) {
      logger.error("[TopicManager] Failed to create session for topic:", error);
      return null;
    }

    const sessionInfo: SessionInfo = {
      id: session.id,
      title: topicName || session.title,
      directory: currentProject.worktree,
    };

    setSessionForTopic(chatId, topicId, sessionInfo);
    await ingestSessionInfoForCache(session);

    logger.info(
      `[TopicManager] Created session for topic: chatId=${chatId}, topicId=${topicId}, sessionId=${session.id}, title="${sessionInfo.title}"`,
    );

    return sessionInfo;
  } catch (err) {
    logger.error("[TopicManager] Error auto-creating session:", err);
    return null;
  }
}

/**
 * Delete the OpenCode session associated with a topic.
 * Called when a forum topic is deleted.
 */
export async function deleteSessionForTopic(
  chatId: number,
  topicId: number,
): Promise<boolean> {
  const session = removeSessionForTopic(chatId, topicId);
  if (!session) {
    logger.debug(`[TopicManager] No session found for deleted topic: chatId=${chatId}, topicId=${topicId}`);
    return false;
  }

  try {
    await opencodeClient.session.delete({
      sessionID: session.id,
      directory: session.directory,
    });

    logger.info(
      `[TopicManager] Deleted session for removed topic: chatId=${chatId}, topicId=${topicId}, sessionId=${session.id}`,
    );
    return true;
  } catch (err) {
    logger.warn(`[TopicManager] Failed to delete OpenCode session ${session.id}:`, err);
    return false;
  }
}
