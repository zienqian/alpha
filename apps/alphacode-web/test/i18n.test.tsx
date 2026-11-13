import { replaceDraft } from "./fixtures/draft-editor";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";
import { LanguageProvider, languageStorageKey, useLanguage } from "@/i18n/provider";
import { createI18n, namespaces } from "@/i18n/instance";
import { resolveLocale } from "@/i18n/locale";
import { presentNote, presentToolDescription, presentToolOutput } from "@/i18n/presentation";
import { mockSessionApi } from "./fixtures/session-api";

describe("internationalization", () => {
  it("negotiates supported languages without treating Traditional Chinese as Simplified", () => {
    expect(resolveLocale("system", ["zh-TW", "en-GB"])).toEqual({ language: "en", formatLocale: "en-GB" });
    expect(resolveLocale("system", ["invalid", "zh_SG.UTF-8"])).toEqual({ language: "zh-CN", formatLocale: "zh-SG" });
    expect(resolveLocale("system", ["zh-Hant", "fr"])).toEqual({ language: "en", formatLocale: "en-US" });
    expect(resolveLocale("zh-CN", ["en"])).toEqual({ language: "zh-CN", formatLocale: "zh-CN" });
  });

  it("isolates instances, chooses locale plural forms, and preserves external content", async () => {
    const en = createI18n("en"), zh = createI18n("zh-CN");
    const english = en.getFixedT(null, namespaces), chinese = zh.getFixedT(null, namespaces);
    expect([0, 1, 2].map(count => english("sessions:messageCount", { count }))).toEqual(["0 messages", "1 message", "2 messages"]);
    expect([0, 1, 2].map(count => chinese("sessions:messageCount", { count }))).toEqual(["0 条", "1 条", "2 条"]);
    const content = "<script> {{count}} C:\\中文\\a.ts";
    expect(english("sessions:removeAttachment", { name: content })).toBe(`Remove attachment ${content}`);
    expect(presentToolDescription(chinese, { name: "read_file", description: content, descriptionSource: "model" })).toBe(content);
    expect(presentToolOutput(chinese, { name: "read_file", description: "", output: content })).toBe(content);
    expect(presentNote(chinese, { note: "Incomplete preview" })).toBe("Incomplete preview");
    expect(presentNote(chinese, { note: "Incomplete preview", noteCode: "INCOMPLETE_PREVIEW" })).not.toBe("Incomplete preview");
    await en.changeLanguage("zh-CN");
    expect(zh.language).toBe("zh-CN");
    await zh.changeLanguage("en");
    expect(en.language).toBe("zh-CN");
    en.removeResourceBundle("zh-CN", "common");
    expect(en.getFixedT(null, "common")("copyMessage")).toBe("Copy message");
  });

  it("handles corrupt storage, cross-tab changes and OS changes; storage denial still allows switching", () => {
    localStorage.setItem(languageStorageKey, "bad-value");
    const { result } = renderHook(useLanguage, { wrapper: LanguageProvider });
    expect(result.current.preference).toBe("system");
    expect(result.current.language).toBe("zh-CN");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: languageStorageKey, newValue: "en" })));
    expect(result.current.language).toBe("en");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      act(() => result.current.setPreference("system"));
      Object.defineProperty(navigator, "languages", { configurable: true, value: ["en-GB"] });
      act(() => window.dispatchEvent(new Event("languagechange")));
      expect(result.current.formatLocale).toBe("en-GB");
      expect(document.documentElement.lang).toBe("en");
    } finally { spy.mockRestore(); }
  });

  it("changes an active approval UI without touching its draft, SSE connection or request identity", async () => {
    const api = mockSessionApi(), id = "project-notes";
    window.history.replaceState(null, "", `/?session=${id}`);
    const view = api.view(id);
    view.requestId = "running-request"; view.approvalId = "pending-approval";
    view.state = { ...view.state, busy: true, canSend: false, phase: "running",
      approval: { name: "run_command", preview: { type: "command", shell: "pwsh", cwd: "C:\\中文", command: "echo hello" } } };
    render(<AppProviders><App /></AppProviders>);
    await screen.findByText("echo hello");
    const input = screen.getByRole("textbox", { name: "消息草稿" });
    replaceDraft(input, "未发送 <draft>");
    const connections = api.fetch.mock.calls.filter(([url]) => url.endsWith("/events")).length;
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "语言" }), { target: { value: "en" } });
    fireEvent.click(screen.getByRole("button", { name: "Back to conversation" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message draft" }).textContent).toBe("未发送 <draft>"));
    expect(screen.getByText("echo hello")).toBeTruthy();
    expect(view.requestId).toBe("running-request"); expect(view.approvalId).toBe("pending-approval");
    expect(api.fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(0);
    expect(api.fetch.mock.calls.filter(([url]) => url.endsWith("/events"))).toHaveLength(connections);
    expect(localStorage.getItem(languageStorageKey)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
