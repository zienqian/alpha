import type { TextareaRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { ChatSkill, PermissionMode } from "../../chat/contracts";
import { matchingCommands, permissionOptions } from "../commands";
import { CommandPanel } from "./command-panel";
import { colors } from "../theme";

export function Composer(props: {
  skills?: readonly ChatSkill[];
  busy: boolean;
  canSend: boolean;
  focused: boolean;
  permissionMode: PermissionMode;
  settingsSaving: boolean;
  onPermissionChange: (mode: PermissionMode) => Promise<boolean>;
  onCommandOpenChange: (open: boolean) => void;
  onSubmit: (text: string) => void;
}) {
  let input: TextareaRenderable | undefined;
  const dimensions = useTerminalDimensions();
  const [draft, setDraft] = createSignal("");
  const [permission, setPermission] = createSignal(false);
  const [dismissed, setDismissed] = createSignal(false);
  const [selected, setSelected] = createSignal(0);
  const slash = () => /^\/[^\s/]*$/.test(draft().trimStart());
  const matches = () => matchingCommands(draft(), props.skills);
  const panelOpen = () => props.focused && !dismissed() && (permission() || slash());
  const contentChanged = () => {
    const text = input?.plainText ?? "";
    if (text === draft()) return;
    setDraft(text);
    setDismissed(false);
    setSelected(0);
  };
  createEffect(() => props.onCommandOpenChange(panelOpen()));
  onCleanup(() => props.onCommandOpenChange(false));
  const openPermission = () => {
    setPermission(true);
    setDismissed(false);
    setSelected(Math.max(0, permissionOptions.findIndex(option => option.value === props.permissionMode)));
  };
  const choosePermission = async (mode: PermissionMode) => {
    if (await props.onPermissionChange(mode)) {
      setPermission(false);
      input?.setText("");
      setDraft("");
    }
  };
  useKeyboard(key => {
    contentChanged();
    if (!panelOpen() || key.defaultPrevented || key.ctrl || key.meta || key.super) return;
    if (props.settingsSaving) { key.preventDefault(); return; }
    if (key.name === "escape") {
      key.preventDefault();
      setPermission(false);
      setDismissed(true);
    } else if (key.name === "up" || key.name === "down") {
      key.preventDefault();
      const count = permission() ? permissionOptions.length : matches().length;
      if (count) setSelected(index => (index + (key.name === "up" ? -1 : 1) + count) % count);
    } else if ((key.name === "return" && !key.shift) || key.name === "tab") {
      key.preventDefault();
      if (permission()) {
        const option = permissionOptions[selected()];
        if (key.name === "return" && option) void choosePermission(option.value);
      } else if (matches()[selected()]) {
        const command = matches()[selected()];
        if (!command) return;
        if (key.name === "tab") {
          input?.setText(command.name);
          input?.gotoBufferEnd();
        } else if (command.name === "/permission") openPermission();
        else if (props.canSend && !props.busy) {
          input?.setText("");
          setDraft("");
          props.onSubmit(command.name);
        }
      } else if (key.name === "return") {
        submit();
      }
    } else if (permission()) {
      // Keep the draft intact while the picker owns text input.
      key.preventDefault();
    }
  });
  const maxInputHeight = () => Math.max(1, Math.min(6, Math.floor(dimensions().height / 4)));
  const submit = () => {
    const text = input?.plainText;
    if (text?.trim() === "/permission") { openPermission(); return; }
    if (!text?.trim() || !props.canSend || props.busy) return;
    input?.setText("");
    setDraft("");
    props.onSubmit(text);
  };
  return (
    <box flexDirection="column" flexShrink={0}>
    <Show when={panelOpen()}>
      <CommandPanel query={draft()} permission={permission()} selected={selected()}
        skills={props.skills}
        currentMode={props.permissionMode} busy={props.busy} settingsSaving={props.settingsSaving} />
    </Show>
    <box id="composer" flexDirection="row" backgroundColor={colors.surface}
      flexShrink={0} padding={1}>
      <text fg={props.focused ? colors.accent : colors.muted} width={2} flexShrink={0}>›</text>
      <textarea
        id="prompt" ref={value => { input = value; }} flexGrow={1} minWidth={0}
        height="auto" minHeight={1} maxHeight={maxInputHeight()} wrapMode="word"
        focused={props.focused && !permission()}
        placeholder={props.busy ? "Working… draft your next message" : "Describe your task…"}
        placeholderColor={colors.muted}
        cursorStyle={{ style: "line", blinking: true }} selectionOccupancy="boundary"
        cursorColor={colors.foreground} selectionBg="#cddcff" selectionFg={colors.foreground}
        backgroundColor={colors.surface} focusedBackgroundColor={colors.surface}
        textColor={colors.foreground} focusedTextColor={colors.foreground}
        keyBindings={[
          { name: "return", action: "submit" },
          { name: "return", shift: true, action: "newline" },
          { name: "j", ctrl: true, action: "newline" },
        ]}
        onSubmit={submit}
        onContentChange={contentChanged}
      />
    </box>
    </box>
  );
}
