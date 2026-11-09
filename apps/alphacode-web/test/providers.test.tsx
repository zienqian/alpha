import { useQuery, useQueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/components/providers";

describe("AppProviders", () => {
  it("preserves the query client and cache across rerenders", () => {
    const { result, rerender, unmount } = renderHook(() => useQueryClient(), {
      wrapper: AppProviders,
    });
    const client = result.current;
    client.setQueryData(["cached"], "value");

    rerender();

    expect(result.current).toBe(client);
    expect(result.current.getQueryData(["cached"])).toBe("value");
    unmount();
    client.clear();
  });

  it("isolates clients between independent provider mounts", () => {
    const first = renderHook(() => useQueryClient(), { wrapper: AppProviders });
    const second = renderHook(() => useQueryClient(), { wrapper: AppProviders });

    expect(first.result.current).not.toBe(second.result.current);
  });

  it("runs queries within the provider", async () => {
    const queryFn = vi.fn(async () => "ready");
    const { result, unmount } = renderHook(() => ({
      client: useQueryClient(),
      query: useQuery({ queryKey: ["bootstrap"], queryFn }),
    }), { wrapper: AppProviders });

    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data).toBe("ready");
    expect(queryFn).toHaveBeenCalledOnce();
    unmount();
    result.current.client.clear();
  });
});
