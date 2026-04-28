import { memo, useMemo, useState } from "react";
import { getVscodeIconUrlForEntry } from "../../vscode-icons";
import { FileCode2Icon, FolderIcon, FolderOpenIcon } from "lucide-react";
import { cn } from "~/lib/utils";

export const VscodeEntryIcon = memo(function VscodeEntryIcon(props: {
  pathValue: string;
  kind: "file" | "directory";
  theme: "light" | "dark";
  opened?: boolean;
  className?: string;
}) {
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const iconUrl = useMemo(
    () => getVscodeIconUrlForEntry(props.pathValue, props.kind, props.theme),
    [props.kind, props.pathValue, props.theme],
  );
  const failed = failedIconUrl === iconUrl;

  if (failed) {
    return props.kind === "directory" ? (
      props.opened ? (
        <FolderOpenIcon className={cn("size-4 text-muted-foreground/80", props.className)} />
      ) : (
        <FolderIcon className={cn("size-4 text-muted-foreground/80", props.className)} />
      )
    ) : (
      <FileCode2Icon className={cn("size-4 text-muted-foreground/80", props.className)} />
    );
  }

  return (
    <img
      src={iconUrl}
      alt=""
      aria-hidden="true"
      className={cn("size-4 shrink-0 rounded-[3px]", props.className)}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailedIconUrl(iconUrl)}
    />
  );
});
