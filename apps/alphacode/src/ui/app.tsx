import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { Chat } from "../chat/contracts";
import { ApprovalPanel } from "./components/approval-panel";
import { Composer } from "./components/composer";
import { ComposerStatus } from "./components/composer-status";
import { Conversation } from "./components/conversation";
import { StatusBar } from "./components/status-bar";
import { useChatKeyboard } from "./keyboard";
import { colors } from "./theme";
import { useTranslation } from "../i18n/react";
import { presentNotice } from "../i18n/presentation";

export function App(props: { chat: Chat; onExit: () => void }) {
  const { t } = useTranslation();
  const chatStore = useMemo(() => {
    let snapshot = props.chat.state;
    return {
      getSnapshot: () => snapshot,
      subscribe(notify: () => void) {
        const unsubscribe = props.chat.subscribe(next => { snapshot = next; notify(); });
        snapshot = props.chat.state;
        return unsubscribe;
      },
    };
  }, [props.chat]);
  const state = useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot);
  const dimensions = useTerminalDimensions();
  const commandOpen = useRef(false);
  const setCommandOpen = useCallback((open: boolean) => { commandOpen.current = open; }, []);
  useChatKeyboard(props.chat, props.onExit, () => commandOpen.current);
  return (
    <box flexDirection="column" width="100%" height="100%" paddingX={1} paddingTop={1}
      backgroundColor={colors.background} overflow="hidden">
      <Conversation messages={state.messages} />
      <box id="composer-dock" flexDirection="column" width="100%" flexShrink={0} paddingTop={1}>
        {state.approval && <ApprovalPanel request={state.approval} maxHeight={Math.max(4, Math.min(9, dimensions.height - 13))} />}
        {state.error && <text fg={colors.error} flexShrink={0} maxHeight={2}>{presentNotice(t, state.notice, state.error)}</text>}
        <ComposerStatus state={state} />
        <Composer
          skills={props.chat.skills}
          busy={state.busy} canSend={state.canSend}
          focused={!state.approval && !state.closing}
          permissionMode={state.permissionMode}
          settingsSaving={state.settingsSaving}
          onPermissionChange={mode => props.chat.setPermissionMode(mode)}
          onCommandOpenChange={setCommandOpen}
          onSubmit={text => { void props.chat.send(text); }}
        />
        <StatusBar modelId={props.chat.modelId} workspaceRoot={props.chat.workspaceRoot} sessionTitle={state.sessionTitle} />
      </box>
    </box>
  );
}
