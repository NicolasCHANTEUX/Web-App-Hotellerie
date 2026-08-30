import type { FastifyBaseLogger } from "fastify";
import { env } from "./config/env.js";
import { purgeUnusedRoomTypeCovers } from "./modules/media/media.service.js";
import { startNotificationWorker } from "./modules/notifications/notification.service.js";

const MEDIA_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

export function startBackgroundWorker(logger?: FastifyBaseLogger, unref = true) {
  const timers: NodeJS.Timeout[] = [];
  const notificationTimer = startNotificationWorker(logger, unref);
  if (notificationTimer) timers.push(notificationTimer);

  if (env.supabaseSecretKey) {
    const cleanMedia = () => {
      void purgeUnusedRoomTypeCovers()
        .then((result) => {
          if (result.processed > 0) logger?.info(result, "Unused media cleanup completed");
        })
        .catch((error) => logger?.error(error, "Unused media cleanup failed"));
    };
    cleanMedia();
    const mediaTimer = setInterval(cleanMedia, MEDIA_CLEANUP_INTERVAL_MS);
    if (unref) mediaTimer.unref();
    timers.push(mediaTimer);
  }

  return {
    stop() {
      for (const timer of timers) clearInterval(timer);
    },
  };
}
