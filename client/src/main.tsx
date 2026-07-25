import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry up to 3 times with exponential backoff for transient errors (e.g. sandbox waking up)
      retry: (failureCount, error) => {
        // Don't retry auth errors
        if (error instanceof TRPCClientError) {
          const code = error.data?.code;
          if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') return false;
        }
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      // Cache data for 2 minutes before considering stale (reduces redundant API calls)
      staleTime: 2 * 60_000,
      // Keep unused data in cache for 10 minutes (faster back-navigation)
      gcTime: 10 * 60_000,
      // Don't refetch when user switches browser tabs (reduces unnecessary requests)
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  // Use window.top to escape iframe context (e.g. Manus preview panel)
  const target = window.top ?? window;
  target.location.href = getLoginUrl();
};

const isExpectedAuthError = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return false;
  // "Please login" is expected when user is not authenticated — not a real error
  return error.message === UNAUTHED_ERR_MSG;
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    // Only log unexpected errors (skip normal auth redirects)
    if (!isExpectedAuthError(error)) {
      console.error("[API Query Error]", error);
    }
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    // Only log unexpected errors (skip normal auth redirects)
    if (!isExpectedAuthError(error)) {
      console.error("[API Mutation Error]", error);
    }
  }
});

const fetchWithCredentials = (input: RequestInfo | URL, init?: RequestInit) =>
  globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });

const trpcClient = trpc.createClient({
  links: [
    // Mutations use a direct (non-batched) link to avoid batch interference
    // that causes the first click to fail when other queries are in-flight
    splitLink({
      condition: (op) => op.type === "mutation",
      true: httpLink({
        url: "/api/trpc",
        transformer: superjson,
        fetch: fetchWithCredentials,
      }),
      false: httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        fetch: fetchWithCredentials,
      }),
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
