import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 min — data changes via explicit user actions or Tauri events
      gcTime: 10 * 60 * 1000, // 10 min
      retry: 1, // invoke() failures are usually deterministic
    },
  },
});
