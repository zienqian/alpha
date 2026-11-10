import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type PropsWithChildren } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProvider } from "@/i18n/provider";
import { MotionProvider } from "@/components/motion-provider";
import type { SessionGateway } from "@/features/sessions/application/session-gateway";
import { SessionGatewayProvider } from "@/features/sessions/application/session-gateway-provider";
import { httpSessionGateway } from "@/features/sessions/infrastructure/http-session-gateway";

export function AppProviders({ children, sessionGateway = httpSessionGateway }: PropsWithChildren<{ sessionGateway?: SessionGateway }>) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <LanguageProvider><ThemeProvider>
      <MotionProvider><QueryClientProvider client={queryClient}>
        <SessionGatewayProvider gateway={sessionGateway}>{children}</SessionGatewayProvider>
      </QueryClientProvider></MotionProvider>
    </ThemeProvider></LanguageProvider>
  );
}
