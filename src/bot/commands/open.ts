import { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { config } from "../../config.js";
import { getCurrentSession } from "../../session/manager.js";
import { getSessionForTopic, getAllTopicSessions } from "../../session/topic-manager.js";
import { logger } from "../../utils/logger.js";

/**
 * /open command - generates a URL to open the current session in the OpenCode web UI.
 * Sends both a button (without auth) and a text URL (with auth) so the user can pick.
 */
export async function openCommand(ctx: CommandContext<Context>) {
  try {
    const chatType = ctx.chat?.type;
    const topicId = ctx.message?.message_thread_id;
    const chatId = ctx.chat?.id;

    logger.info(`[Bot] /open: chatType=${chatType}, chatId=${chatId}, topicId=${topicId}`);

    // Resolve session based on context
    let session = null;
    if ((chatType === "group" || chatType === "supergroup") && chatId) {
      if (topicId) {
        session = getSessionForTopic(chatId, topicId);
      }
      if (!session) {
        const allSessions = getAllTopicSessions(chatId);
        if (allSessions.length === 1) {
          session = allSessions[0].session;
        } else if (allSessions.length > 1) {
          const list = allSessions.map(s => `- ${s.session.title} (topic ${s.topicId})`).join("\n");
          await ctx.reply(`Multiple sessions found. Use /open in the specific topic:\n${list}`);
          return;
        }
      }
    } else {
      session = getCurrentSession();
    }

    if (!session) {
      await ctx.reply("No active session. Send a message first to create one.");
      return;
    }

    const publicUrl = config.opencode.publicUrl;
    if (!publicUrl) {
      await ctx.reply(
        `Session: ${session.title}\nID: ${session.id}\n\nSet OPENCODE_PUBLIC_URL in .env to enable browser links.`,
      );
      return;
    }

    const directoryBase64 = Buffer.from(session.directory).toString("base64");
    const sessionPath = `${directoryBase64}/session/${session.id}`;

    // Clean URL for the button (no auth - Telegram blocks it)
    const cleanUrl = `${publicUrl}/${sessionPath}`;

    // Auth URL as text (user:pass@host - clickable in Telegram messages)
    let authUrl = cleanUrl;
    if (config.opencode.password) {
      const parsed = new URL(publicUrl);
      parsed.username = config.opencode.username || "opencode";
      parsed.password = config.opencode.password;
      authUrl = `${parsed.toString()}${sessionPath}`;
    }

    const keyboard = new InlineKeyboard().url("Open in Browser", cleanUrl);

    let message = `Session: ${session.title}\nID: ${session.id}`;
    if (config.opencode.password) {
      message += `\n\nDirect link (with auth):\n${authUrl}`;
    }

    await ctx.reply(message, { reply_markup: keyboard });

    logger.info(`[Bot] /open: sessionId=${session.id}, dir=${session.directory}`);
  } catch (err) {
    logger.error("[Bot] Error in /open command:", err);
    await ctx.reply("Failed to generate session URL.");
  }
}
