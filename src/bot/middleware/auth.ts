import { Context, NextFunction } from "grammy";
import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";

export async function authMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  const chatType = ctx.chat?.type;

  logger.debug(
    `[Auth] Checking access: userId=${userId}, allowedUserIds=${config.telegram.allowedUserIds}, chatType=${chatType}, hasCallbackQuery=${!!ctx.callbackQuery}, hasMessage=${!!ctx.message}`,
  );

  // In forum groups, ONLY respond in topics — never in General
  if (chatType === "group" || chatType === "supergroup") {
    const threadId = ctx.message?.message_thread_id ?? ctx.callbackQuery?.message?.message_thread_id;
    if (!threadId) {
      logger.debug(`[Auth] Ignoring message in General topic (humans only)`);
      return;
    }
    logger.debug(`[Auth] Access granted in group topic (chatId=${ctx.chat?.id}, topicId=${threadId}, userId=${userId})`);
    await next();
    return;
  }

  // Allow access if user is in whitelist (private chats)
  if (userId && config.telegram.allowedUserIds.includes(userId)) {
    logger.debug(`[Auth] Access granted for userId=${userId}`);
    await next();
    return;
  }

  // Silently ignore unauthorized users in private chats
  logger.warn(`Unauthorized access attempt from user ID: ${userId}`);

  if (ctx.chat?.id && !config.telegram.allowedUserIds.includes(ctx.chat.id)) {
    try {
      await ctx.api.setMyCommands([], {
        scope: { type: "chat", chat_id: ctx.chat.id },
      });
      logger.debug(`[Auth] Set empty commands for unauthorized chat_id=${ctx.chat.id}`);
    } catch (err) {
      logger.debug(`[Auth] Could not set empty commands: ${err}`);
    }
  }
}
