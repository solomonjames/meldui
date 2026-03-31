import { createTicketStoreFactory } from "@/shared/stores/create-ticket-store";
import type { ReviewComment, ReviewFinding } from "@/shared/types";

export interface ReviewState {
  findings: ReviewFinding[];
  comments: ReviewComment[];
  pendingRequestId: string | null;
  roundKey: number;
  setFindings: (findings: ReviewFinding[], requestId: string) => void;
  addComment: (filePath: string, lineNumber: number, content: string, suggestion?: string) => void;
  deleteComment: (commentId: string) => void;
  clearAfterApproval: () => void;
  clearAfterRequestChanges: () => void;
}

export const reviewStoreFactory = createTicketStoreFactory<ReviewState>((set) => ({
  findings: [],
  comments: [],
  pendingRequestId: null,
  roundKey: 0,
  setFindings: (findings, requestId) =>
    set((s) => ({
      findings,
      pendingRequestId: requestId,
      roundKey: s.roundKey + 1,
    })),
  addComment: (filePath, lineNumber, content, suggestion?) => {
    const comment: ReviewComment = {
      id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file_path: filePath,
      line_number: lineNumber,
      content,
      suggestion,
      resolved: false,
    };
    set((s) => ({ comments: [...s.comments, comment] }));
  },
  deleteComment: (commentId) =>
    set((s) => ({ comments: s.comments.filter((c) => c.id !== commentId) })),
  clearAfterApproval: () => set({ findings: [], comments: [], pendingRequestId: null }),
  clearAfterRequestChanges: () =>
    set((s) => ({
      findings: [],
      comments: s.comments.map((c) => ({ ...c, resolved: true })),
      pendingRequestId: null,
    })),
}));
