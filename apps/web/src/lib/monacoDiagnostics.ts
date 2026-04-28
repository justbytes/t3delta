import type { OnMount } from "@monaco-editor/react";

import { configureMonacoProjectEnvironment } from "./monacoProjectEnvironment";
import type { MonacoProjectProfile } from "./monacoProjectProfile";

type MonacoInstance = Parameters<OnMount>[1];

export function configureMonacoDiagnostics(
  monaco: MonacoInstance,
  options: { readonly mode: "off" | "syntax" | "full"; readonly profile: MonacoProjectProfile },
) {
  const sharedCompilerOptions =
    options.profile === "web"
      ? {
          allowNonTsExtensions: true,
          allowSyntheticDefaultImports: true,
          esModuleInterop: true,
          jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
          lib: ["es2023", "dom", "dom.iterable"],
          module: monaco.languages.typescript.ModuleKind.ESNext,
          moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
          resolveJsonModule: true,
          target: monaco.languages.typescript.ScriptTarget.ES2020,
          useDefineForClassFields: true,
        }
      : {
          allowNonTsExtensions: true,
          allowSyntheticDefaultImports: true,
          esModuleInterop: true,
          lib: ["esnext"],
          module: monaco.languages.typescript.ModuleKind.CommonJS,
          moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
          resolveJsonModule: true,
          target: monaco.languages.typescript.ScriptTarget.ESNext,
          useDefineForClassFields: true,
        };

  monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
  monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
  configureMonacoProjectEnvironment(monaco, options.profile);

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    ...sharedCompilerOptions,
    allowJs: false,
    checkJs: false,
    strict: false,
  });

  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    ...sharedCompilerOptions,
    allowJs: true,
    checkJs: true,
  });

  const syntaxEnabled = true;
  const semanticEnabled = options.profile === "web" && options.mode === "full";

  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: !semanticEnabled,
    noSyntaxValidation: !syntaxEnabled,
    noSuggestionDiagnostics: !semanticEnabled,
  });

  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: !semanticEnabled,
    noSyntaxValidation: !syntaxEnabled,
    noSuggestionDiagnostics: !semanticEnabled,
  });
}
