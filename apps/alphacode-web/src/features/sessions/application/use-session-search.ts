import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SessionFolder } from "@/features/sessions/types";
import { localSessionResults, recentSessionResults } from "@/features/sessions/domain/search";
import { sessionKeys } from "./session-cache";
import { useSessionGateway } from "./session-gateway-provider";

export function useSessionSearch(folders: readonly SessionFolder[]) {
  const gateway = useSessionGateway();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const normalized = input.trim();

  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => setQuery(normalized), 180);
    return () => clearTimeout(timer);
  }, [normalized, composing]);

  const search = useQuery({
    queryKey: sessionKeys.search(query),
    queryFn: ({ signal }) => gateway.search(query, signal),
    enabled: Boolean(query) && query === normalized && !composing,
    retry: false,
  });
  const waiting = Boolean(normalized) && (query !== normalized || composing || search.isPending);
  const results = !normalized ? recentSessionResults(folders) : waiting || search.isError ? []
    : [...localSessionResults(folders, normalized), ...(search.data ?? [])];

  return {
    input, setInput, normalized, setComposing, waiting, results, search,
    clear: () => { setInput(""); setQuery(""); },
  };
}
