/**
 * Generate a ticket ID using crypto.randomUUID().
 * Format: meld-{first 8 chars of uuid}
 */
export function generateTicketId(): string {
  const uuid = crypto.randomUUID();
  return `meld-${uuid.slice(0, 8)}`;
}

/**
 * Check if a string is a valid ticket ID format.
 */
export function isValidTicketId(id: string): boolean {
  return /^meld-[a-f0-9]{8}$/.test(id);
}
