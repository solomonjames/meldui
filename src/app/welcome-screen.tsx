import { FolderOpen } from "lucide-react";
import { Button } from "@/shared/ui/button";

interface WelcomeScreenProps {
  onOpenFolder: () => void;
}

export function WelcomeScreen({ onOpenFolder }: WelcomeScreenProps) {
  return (
    <div className="flex items-center justify-center h-screen w-screen bg-background">
      <div className="flex flex-col items-center gap-4 text-center max-w-sm">
        <div className="rounded-full bg-emerald-muted p-4">
          <FolderOpen className="w-8 h-8 text-emerald" />
        </div>
        <h1 className="text-xl font-semibold">Welcome to Meld</h1>
        <p className="text-sm text-muted-foreground">
          AI-powered development that ships your tickets.
        </p>
        <ul className="text-sm text-muted-foreground space-y-1.5 text-left">
          <li>Create tickets and let AI research, plan, and implement</li>
          <li>Review AI-generated specs and code changes</li>
          <li>Track progress across your development workflow</li>
        </ul>
        <Button onClick={onOpenFolder} className="bg-emerald hover:bg-emerald/90 text-white mt-2">
          <FolderOpen className="w-4 h-4 mr-2" />
          Open Project Folder
        </Button>
      </div>
    </div>
  );
}
