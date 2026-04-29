export const BRAND_ASSET_PATHS = {
  productionMacIconPng: "assets/prod/t3delta-camo-macos-1024.png",
  productionLinuxIconPng: "assets/prod/t3delta-camo-universal-1024.png",
  productionWindowsIconIco: "assets/prod/t3delta-camo-windows.ico",
  productionWebFaviconIco: "assets/prod/t3delta-camo-web-favicon.ico",
  productionWebFavicon16Png: "assets/prod/t3delta-camo-web-favicon-16x16.png",
  productionWebFavicon32Png: "assets/prod/t3delta-camo-web-favicon-32x32.png",
  productionWebAppleTouchIconPng: "assets/prod/t3delta-camo-web-apple-touch-180.png",

  nightlyMacIconPng: "assets/nightly/t3delta-dev-macos-1024.png",
  nightlyLinuxIconPng: "assets/nightly/t3delta-dev-universal-1024.png",
  nightlyWindowsIconIco: "assets/nightly/t3delta-dev-windows.ico",

  developmentDesktopIconPng: "assets/dev/t3delta-dev-macos-1024.png",
  developmentWindowsIconIco: "assets/dev/t3delta-dev-windows.ico",
  developmentWebFaviconIco: "assets/dev/t3delta-dev-web-favicon.ico",
  developmentWebFavicon16Png: "assets/dev/t3delta-dev-web-favicon-16x16.png",
  developmentWebFavicon32Png: "assets/dev/t3delta-dev-web-favicon-32x32.png",
  developmentWebAppleTouchIconPng: "assets/dev/t3delta-dev-web-apple-touch-180.png",
} as const;

export interface IconOverride {
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}

export const DEVELOPMENT_ICON_OVERRIDES: ReadonlyArray<IconOverride> = [
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    targetRelativePath: "dist/client/favicon.ico",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    targetRelativePath: "dist/client/favicon-16x16.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    targetRelativePath: "dist/client/favicon-32x32.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
    targetRelativePath: "dist/client/apple-touch-icon.png",
  },
];

export const PUBLISH_ICON_OVERRIDES: ReadonlyArray<IconOverride> = [
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFaviconIco,
    targetRelativePath: "dist/client/favicon.ico",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    targetRelativePath: "dist/client/favicon-16x16.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    targetRelativePath: "dist/client/favicon-32x32.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
    targetRelativePath: "dist/client/apple-touch-icon.png",
  },
];
