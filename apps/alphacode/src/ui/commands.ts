import type { PermissionMode } from "../chat/contracts";

export const commands = [
  { name: "/permission", description: "选择工具与命令的审批方式" },
] as const;

export const permissionOptions: readonly { value: PermissionMode; name: string; description: string }[] = [
  { value: "ask", name: "Ask for approval", description: "执行命令前询问；工作区文件工具沿用默认权限" },
  { value: "auto", name: "Approve for me", description: "自动批准常规低风险命令，其余仍询问" },
  { value: "full", name: "Full access", description: "自动允许全部工具和命令，使用当前进程权限" },
];

export function matchingCommands(text: string) {
  return commands.filter(command => command.name.startsWith(text.trim()));
}
