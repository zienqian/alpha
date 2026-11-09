import { render as renderReact, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { LanguageProvider } from "@/i18n/provider";

export * from "@testing-library/react";
export function render(ui: ReactElement, options: RenderOptions = {}): RenderResult {
  const Wrapper = options.wrapper;
  return renderReact(ui, { ...options, wrapper: ({ children }: PropsWithChildren) => (
    <LanguageProvider initialPreference="zh-CN">
      {Wrapper ? <Wrapper>{children}</Wrapper> : children}
    </LanguageProvider>
  ) });
}
