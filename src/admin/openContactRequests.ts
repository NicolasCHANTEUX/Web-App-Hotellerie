import { useEffect, useState } from "react";
import { getAdminContactRequestSummary } from "../api/admin";
import { useAdminAuth } from "./auth";

const OPEN_COUNT_EVENT = "admin:open-contact-requests";
const REFRESH_INTERVAL_MS = 120_000;

/** Lets a screen that has just loaded the count update the menu badge at once. */
export function publishOpenContactRequests(count: number) {
  window.dispatchEvent(new CustomEvent<number>(OPEN_COUNT_EVENT, { detail: count }));
}

/**
 * Contact requests still to answer, for the menu badge: refreshed every two
 * minutes, when the tab comes back into view and whenever a screen publishes it.
 */
export function useOpenContactRequests(enabled: boolean) {
  const { accessToken } = useAdminAuth();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !accessToken) {
      setCount(null);
      return;
    }
    let controller: AbortController | null = null;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      controller = new AbortController();
      getAdminContactRequestSummary(accessToken, controller.signal)
        .then((summary) => setCount(summary.open))
        .catch(() => {
          // Only a hint: a failed refresh keeps the last known count.
        });
    };
    const receive = (event: Event) => setCount((event as CustomEvent<number>).detail);

    refresh();
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(OPEN_COUNT_EVENT, receive);
    return () => {
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(OPEN_COUNT_EVENT, receive);
    };
  }, [accessToken, enabled]);

  return count;
}
