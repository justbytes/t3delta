import { DiffIcon, FolderIcon, PlusIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { Skeleton } from "./ui/skeleton";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Button } from "./ui/button";

export type WorkspaceSidecarMode = "diff" | "explorer";
export type WorkspaceSidecarLayoutMode = "inline" | "sheet" | "sidebar";
const EMPTY_SIDECARS: ReadonlyArray<WorkspaceSidecarMode> = [];

export function WorkspaceSidecarShell(props: {
  mode: WorkspaceSidecarLayoutMode;
  sidecar: WorkspaceSidecarMode;
  openSidecars?: ReadonlyArray<WorkspaceSidecarMode>;
  availableSidecars?: ReadonlyArray<WorkspaceSidecarMode>;
  onSelectSidecar?: (sidecar: WorkspaceSidecarMode) => void;
  onAddSidecar?: (sidecar: WorkspaceSidecarMode) => void;
  onCloseSidecarTab?: (sidecar: WorkspaceSidecarMode) => void;
  header?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const availableSidecars = props.availableSidecars ?? EMPTY_SIDECARS;
  const tabs = props.openSidecars?.length ? props.openSidecars : [props.sidecar];
  const hasAvailableSidecars = availableSidecars.length > 0;

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col bg-transparent",
        props.mode === "inline"
          ? props.sidecar === "diff"
            ? "w-[42vw] min-w-[360px] max-w-[560px] shrink-0"
            : "w-[42vw] min-w-0 max-w-[560px] shrink-0"
          : "w-full",
      )}
    >
      <div className="flex min-h-[34px] shrink-0 items-end gap-1 border-b border-border/50 px-2 pt-2 [-webkit-app-region:no-drag]">
        {tabs.map((tab) => {
          const active = props.sidecar === tab;
          const Icon = tab === "diff" ? DiffIcon : FolderIcon;
          const label = tab === "diff" ? "Git diff" : "Explorer";
          return (
            <div
              key={tab}
              className={cn(
                "group flex h-7 min-w-0 max-w-32 items-center gap-1.5 rounded-t-lg border px-2 text-xs transition-colors",
                active
                  ? "border-border/60 border-b-transparent bg-background/45 text-foreground"
                  : "border-border/35 bg-background/20 text-muted-foreground hover:bg-background/35 hover:text-foreground",
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5"
                onClick={() => props.onSelectSidecar?.(tab)}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{label}</span>
              </button>
              <button
                type="button"
                className="ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 opacity-70 transition hover:bg-muted hover:text-foreground group-hover:opacity-100"
                aria-label={`Close ${label} tab`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onCloseSidecarTab?.(tab);
                }}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          );
        })}
        {hasAvailableSidecars ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label="Open workspace sidebar tab"
                  size="icon-xs"
                  variant="outline"
                  className="mb-px size-6 rounded-md border-border/45 bg-background/20 text-muted-foreground hover:bg-background/35 hover:text-foreground"
                />
              }
            >
              <PlusIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="start">
              <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">
                Add tab
              </div>
              {availableSidecars.map((sidecar) => {
                const Icon = sidecar === "diff" ? DiffIcon : FolderIcon;
                const label = sidecar === "diff" ? "Git diff" : "File explorer";
                return (
                  <MenuItem key={sidecar} onClick={() => props.onAddSidecar?.(sidecar)}>
                    <Icon />
                    {label}
                  </MenuItem>
                );
              })}
            </MenuPopup>
          </Menu>
        ) : null}
      </div>
      {props.header ? (
        <div className="border-b border-border/50 bg-card/10 backdrop-blur-sm">
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
