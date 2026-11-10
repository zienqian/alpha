import { createContext, useContext, type PropsWithChildren } from "react";
import type { SessionGateway } from "./session-gateway";

const GatewayContext = createContext<SessionGateway | undefined>(undefined);

export function SessionGatewayProvider({ gateway, children }: PropsWithChildren<{ gateway: SessionGateway }>) {
  return <GatewayContext value={gateway}>{children}</GatewayContext>;
}

export function useSessionGateway() {
  const gateway = useContext(GatewayContext);
  if (!gateway) throw new Error("SESSION_GATEWAY_PROVIDER_REQUIRED");
  return gateway;
}
