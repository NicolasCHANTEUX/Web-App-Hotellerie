import { DependencyList, useEffect, useState } from "react";

type RemoteState<T> = {
  data: T | null;
  error: string | null;
  errorStatus: number | null;
  loading: boolean;
};

export function useRemoteData<T>(loader: (signal: AbortSignal) => Promise<T>, dependencies: DependencyList) {
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<RemoteState<T>>({ data: null, error: null, errorStatus: null, loading: true });

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ data: current.data, error: null, errorStatus: null, loading: true }));
    loader(controller.signal)
      .then((data) => setState({ data, error: null, errorStatus: null, loading: false }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
          ? error.status
          : null;
        setState({
          data: null,
          error: error instanceof Error ? error.message : "Une erreur est survenue.",
          errorStatus: status,
          loading: false,
        });
      });
    return () => controller.abort();
    // The caller controls exactly when its loader must run through dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, retryKey]);

  return { ...state, retry: () => setRetryKey((key) => key + 1) };
}
