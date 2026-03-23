export const conversationKeys = {
  ticket: (projectDir: string, ticketId: string) =>
    ["conversations", projectDir, ticketId] as const,
  list: (projectDir: string) => ["conversations", "list", projectDir] as const,
};
