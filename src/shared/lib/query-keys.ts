// Query key factories — shared across features and invalidation hooks.
// Extracted to shared/ so invalidation.ts doesn't import from features/.

export const ticketKeys = {
  all: (projectDir: string) => ["tickets", "all", projectDir] as const,
  detail: (projectDir: string, id: string) => ["tickets", "detail", projectDir, id] as const,
};
