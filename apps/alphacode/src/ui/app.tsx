import { createSignal, onCleanup, Show, type Accessor } from "solid-js";
import type { ApprovalRequest, Chat } from "../chat/contracts";
import { ApprovalPanel } from "./components/approval-panel";
import { Composer } from "./components/composer";
import { Conversation } from "./components/conversation";
import { Welcome } from "./components/welcome";
import { useChatKeyboard } from "./keyboard";
import { colors } from "./theme";

export function App(props: { chat: Chat; onExit: () => void }) {
  const [state, setState] = createSignal(props.chat.state);
  onCleanup(props.chat.subscribe(setState));
  useChatKeyboard(props.chat, props.onExit);
  const welcome = () => state().messages.length === 0;
  return (
    <box flexDirection="column" width="100%" height="100%" padding={1} gap={1} backgroundColor={colors.background}
      alignItems="center" justifyContent={welcome() ? "center" : "flex-start"}>
      <Show when={welcome()}><Welcome /></Show>
      <Show when={!welcome()}>
        <box flexDirection="row" width="100%" gap={2} flexShrink={0}>
          <text fg={colors.accent}><b>AlphaCode</b></text>
          <text fg={colors.muted}>{props.chat.modelId}</text>
        </box>
        <text fg={colors.muted} width="100%" flexShrink={0}>{props.chat.workspaceRoot}</text>
        <Conversation messages={state().messages} />
      </Show>
      <box flexDirection="column" width="100%" maxWidth={welcome() ? 80 : undefined} flexShrink={0} gap={1}>
        <Show when={state().approval}>{(request: Accessor<ApprovalRequest>) => <ApprovalPanel request={request()} />}</Show>
        <Show when={state().error}><text fg={colors.error} flexShrink={0}>{state().error}</text></Show>
        <Composer
          busy={state().busy} canSend={state().canSend}
          focused={!state().approval && !state().closing}
          onSubmit={text => { void props.chat.send(text); }}
        />
        <Show when={welcome()}>
          <text fg={colors.muted}>{props.chat.modelId} · {props.chat.workspaceRoot}</text>
        </Show>
        <text fg={colors.muted} flexShrink={0}>{state().status} · Enter 发送 · Ctrl+J 换行 · Esc 停止 · Ctrl+C 退出</text>
      </box>
    </box>
  );
}
