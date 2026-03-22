import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function createQueryWrapper(queryClient?: QueryClient) {
  const client = queryClient ?? createTestQueryClient();
  return function QueryWrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
