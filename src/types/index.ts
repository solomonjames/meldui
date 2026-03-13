export interface ClaudeStatus {
  installed: boolean;
  authenticated: boolean;
  path?: string;
  message: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

// Matches beads JSON output exactly
export interface BeadsIssue {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
  description?: string;
  notes?: string;
  design?: string;
  acceptance?: string;
  owner?: string;
  assignee?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  close_reason?: string;
  created_by?: string;
  dependency_count?: number;
  dependent_count?: number;
  comment_count?: number;
  labels?: string[];
  parent_id?: string;
}

export interface BeadsStatus {
  installed: boolean;
  initialized: boolean;
  path?: string;
  message: string;
}
