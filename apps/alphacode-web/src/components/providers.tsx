import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type PropsWithChildren } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProvider } from "@/i18n/provider";
import { MotionProvider } from "@/components/motion-provider";

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <LanguageProvider><ThemeProvider>
      <MotionProvider><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></MotionProvider>
    </ThemeProvider></LanguageProvider>
  );
}
