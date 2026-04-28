export type MonacoProjectProfile = "web" | "node";

const WEB_PATH_PREFIXES = ["frontend/", "t3delta/apps/web/", "t3delta/apps/marketing/"] as const;

export function resolveMonacoProjectProfile(pathValue: string): MonacoProjectProfile {
  const normalizedPath = pathValue.replace(/\\/g, "/");

  if (normalizedPath.endsWith(".tsx") || normalizedPath.endsWith(".jsx")) {
    return "web";
  }

  for (const prefix of WEB_PATH_PREFIXES) {
    if (normalizedPath.startsWith(prefix)) {
      return "web";
    }
  }

  return "node";
}
