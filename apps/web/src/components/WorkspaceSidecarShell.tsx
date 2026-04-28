import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { Skeleton } from "./ui/skeleton";

export type WorkspaceSidecarMode = "diff" | "explorer";
export type WorkspaceSidecarLayoutMode = "inline" | "sheet" | "sidebar";

export function WorkspaceSidecarShell(props: {
  mode: WorkspaceSidecarLayoutMode;
  sidecar: WorkspaceSidecarMode;
  onSelectSidecar?: (sidecar: WorkspaceSidecarMode) => void;
  header?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col bg-background/95 backdrop-blur-sm",
        props.mode === "inline"
          ? props.sidecar === "diff"
            ? "w-[42vw] min-w-[360px] max-w-[560px] shrink-0 border-l border-border"
            : "w-[42vw] min-w-0 max-w-[560px] shrink-0 border-l border-border"
          : "w-full",
      )}
    >
      {props.header ? (
        <div className="border-b border-border/70 bg-card/30">
          <div className="min-h-[52px] [-webkit-app-region:no-drag]">{props.header}</div>
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

export function WorkspaceSidecarHeaderSkeleton() {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <div className="relative min-w-0 flex-1">
        <Skeleton className="absolute left-0 top-1/2 size-6 -translate-y-1/2 rounded-md border border-border/50" />
        <Skeleton className="absolute right-0 top-1/2 size-6 -translate-y-1/2 rounded-md border border-border/50" />
        <div className="flex gap-1 overflow-hidden px-8 py-0.5">
          <Skeleton className="h-6 w-20 shrink-0 rounded-md" />
          <Skeleton className="h-6 w-24 shrink-0 rounded-md" />
          <Skeleton className="h-6 w-24 shrink-0 rounded-md max-sm:hidden" />
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="size-7 rounded-md" />
      </div>
    </div>
  );
}

export function WorkspaceSidecarLoadingState(props: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/60 bg-card/25"
        role="status"
        aria-live="polite"
        aria-label={props.label}
      >
        <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
          <Skeleton className="h-4 w-32 rounded-full" />
          <Skeleton className="ml-auto h-4 w-20 rounded-full" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 py-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="h-3 w-10/12 rounded-full" />
            <Skeleton className="h-3 w-11/12 rounded-full" />
            <Skeleton className="h-3 w-9/12 rounded-full" />
          </div>
          <span className="sr-only">{props.label}</span>
        </div>
      </div>
    </div>
  );
}
