import { createSignal, onCleanup, Show, type Accessor } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import type { ApprovalRequest, Chat } from "../chat/contracts";
import { ApprovalPanel } from "./components/approval-panel";
import { Composer } from "./components/composer";
import { ComposerStatus } from "./components/composer-status";
import { Conversation } from "./components/conversation";
import { StatusBar } from "./components/status-bar";
import { useChatKeyboard } from "./keyboard";
import { colors } from "./theme";

export function App(props: { chat: Chat; onExit: () => void }) {
  const [state, setState] = createSignal(props.chat.state);
  const dimensions = useTerminalDimensions();
  const [commandOpen, setCommandOpen] = createSignal(false);
  onCleanup(props.chat.subscribe(setState));
  useChatKeyboard(props.chat, props.onExit, commandOpen);
  return (
    <box flexDirection="column" width="100%" height="100%" paddingX={1} paddingTop={1}
      backgroundColor={colors.background} overflow="hidden">
      <Conversation messages={state().messages} />
      <box id="composer-dock" flexDirection="column" width="100%" flexShrink={0} paddingTop={1}>
        <Show when={state().approval}>{(request: Accessor<ApprovalRequest>) => (
          <ApprovalPanel request={request()} maxHeight={Math.max(4, Math.min(9, dimensions().height - 13))} />
        )}</Show>
        <Show when={state().error}>
          <text fg={colors.error} flexShrink={0} maxHeight={2}>{state().error}</text>
        </Show>
        <ComposerStatus state={state()} />
        <Composer
          busy={state().busy} canSend={state().canSend}
          focused={!state().approval && !state().closing}
          permissionMode={state().permissionMode}
          settingsSaving={state().settingsSaving}
          onPermissionChange={mode => props.chat.setPermissionMode(mode)}
          onCommandOpenChange={setCommandOpen}
          onSubmit={text => { void props.chat.send(text); }}
        />
        <StatusBar modelId={props.chat.modelId} workspaceRoot={props.chat.workspaceRoot} permissionMode={state().permissionMode} />
      </box>
    </box>
  );
}
