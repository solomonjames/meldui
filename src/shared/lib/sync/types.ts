import type { Ticket } from "@/shared/lib/tickets/types";

export interface ExternalTicket {
  external_id: string;
  source: string;
  data: Record<string, unknown>;
}

export interface SyncAdapter {
  pushTicket(ticket: Ticket): Promise<string>;
  pullAll(): Promise<ExternalTicket[]>;
  deleteExternal(externalId: string): Promise<void>;
  mapToTicket(external: ExternalTicket): Ticket;
  mapFromTicket(ticket: Ticket): ExternalTicket;
}

export interface SyncSettings {
  enabled: boolean;
  provider: string;
  auto_push: boolean;
  config: Record<string, string>;
}

export interface WorktreeSettings {
  setup_command?: string;
}

export interface SupervisorSettings {
  custom_prompt?: string;
  max_replies_per_step?: number;
}

export interface ProjectSettings {
  sync?: SyncSettings;
  worktree?: WorktreeSettings;
  supervisor?: SupervisorSettings;
}
