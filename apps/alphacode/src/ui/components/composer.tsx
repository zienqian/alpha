import type { TextareaRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useLayoutEffect, useRef, useState } from "react";
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
  const input = useRef<TextareaRenderable>(null);
  const dimensions = useTerminalDimensions();
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const [menu, setMenu] = useState({ permission: false, dismissed: false, selected: 0 });
  const menuRef = useRef(menu);
  const updateMenu = (patch: Partial<typeof menu>) => {
    menuRef.current = { ...menuRef.current, ...patch };
    setMenu(menuRef.current);
    props.onCommandOpenChange(props.focused && !menuRef.current.dismissed
      && (menuRef.current.permission || /^\/[^\s/]*$/.test(draftRef.current.trimStart())));
  };
  const panelOpen = props.focused && !menu.dismissed && (menu.permission || /^\/[^\s/]*$/.test(draft.trimStart()));
  const contentChanged = () => {
    const text = input.current?.plainText ?? "";
    if (text === draftRef.current) return;
    draftRef.current = text;
    setDraft(text);
    updateMenu({ dismissed: false, selected: 0 });
  };
  const { onCommandOpenChange } = props;
  useLayoutEffect(() => onCommandOpenChange(panelOpen), [onCommandOpenChange, panelOpen]);
  useLayoutEffect(() => () => onCommandOpenChange(false), [onCommandOpenChange]);
  const openPermission = () => {
    updateMenu({ permission: true, dismissed: false,
      selected: Math.max(0, permissionOptions.findIndex(option => option.value === props.permissionMode)) });
  };
  const choosePermission = async (mode: PermissionMode) => {
    if (await props.onPermissionChange(mode)) {
      if (!input.current || input.current.isDestroyed) return;
      updateMenu({ permission: false });
      input.current.setText("");
      contentChanged();
    }
  };
  useKeyboard(key => {
    contentChanged();
    const current = menuRef.current;
    const slash = /^\/[^\s/]*$/.test(draftRef.current.trimStart());
    const matches = matchingCommands(draftRef.current, props.skills);
    if (!props.focused || current.dismissed || (!current.permission && !slash) || key.defaultPrevented || key.ctrl || key.meta || key.super) return;
    if (props.settingsSaving) { key.preventDefault(); return; }
    if (key.name === "escape") {
      key.preventDefault();
      updateMenu({ permission: false, dismissed: true });
    } else if (key.name === "up" || key.name === "down") {
      key.preventDefault();
      const count = current.permission ? permissionOptions.length : matches.length;
      if (count) updateMenu({ selected: (current.selected + (key.name === "up" ? -1 : 1) + count) % count });
    } else if ((key.name === "return" && !key.shift) || key.name === "tab") {
      key.preventDefault();
      if (current.permission) {
        const option = permissionOptions[current.selected];
        if (key.name === "return" && option) void choosePermission(option.value);
      } else if (matches[current.selected]) {
        const command = matches[current.selected];
        if (!command) return;
        if (key.name === "tab") {
          input.current?.setText(command.name);
          input.current?.gotoBufferEnd();
          contentChanged();
        } else if (command.name === "/permission") openPermission();
        else if (command.name === "/web" || (props.canSend && !props.busy)) {
          input.current?.setText("");
          contentChanged();
          props.onSubmit(command.name);
        }
      } else if (key.name === "return") {
        submit();
      }
    } else if (current.permission) {
      // Keep the draft intact while the picker owns text input.
      key.preventDefault();
    }
  });
  const maxInputHeight = Math.max(1, Math.min(6, Math.floor(dimensions.height / 4)));
  const submit = () => {
    const text = input.current?.plainText;
    if (text?.trim() === "/permission") { openPermission(); return; }
    if (!text?.trim() || (text.trim() !== "/web" && (!props.canSend || props.busy))) return;
    input.current?.setText("");
    contentChanged();
    props.onSubmit(text);
  };
  return (
    <box flexDirection="column" flexShrink={0}>
    {panelOpen && (
      <CommandPanel query={draft} permission={menu.permission} selected={menu.selected}
        skills={props.skills}
        currentMode={props.permissionMode} busy={props.busy} settingsSaving={props.settingsSaving} />
    )}
    <box id="composer" flexDirection="row" backgroundColor={colors.surface}
      flexShrink={0} padding={1}>
      <text fg={props.focused ? colors.accent : colors.muted} width={2} flexShrink={0}>›</text>
      <textarea
        id="prompt" ref={input} flexGrow={1} minWidth={0}
        height="auto" minHeight={1} maxHeight={maxInputHeight} wrapMode="word"
        focused={props.focused && !menu.permission}
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
