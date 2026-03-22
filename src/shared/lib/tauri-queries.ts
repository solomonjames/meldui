import type { QueryKey, UseMutationOptions } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

/**
 * Creates useQuery options for a Tauri invoke() call.
 */
export function createTauriQuery<T>(
  queryKey: QueryKey,
  command: string,
  params?: Record<string, unknown>,
) {
  return {
    queryKey,
    queryFn: () => invoke<T>(command, params),
  };
}

/**
 * Creates useMutation options for a Tauri invoke() call.
 */
export function createTauriMutation<TVariables, TResult = void>(
  command: string,
  mapVariables?: (vars: TVariables) => Record<string, unknown>,
): Pick<UseMutationOptions<TResult, Error, TVariables>, "mutationFn"> {
  return {
    mutationFn: (variables: TVariables) =>
      invoke<TResult>(
        command,
        mapVariables ? mapVariables(variables) : (variables as unknown as Record<string, unknown>),
      ),
  };
}
