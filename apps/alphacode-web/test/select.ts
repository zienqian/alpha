import { fireEvent, screen, waitFor } from "@testing-library/react";

/** Exercise the keyboard-accessible shadcn Select rather than its hidden native form field. */
export async function chooseSelect(trigger: HTMLElement, option: string) {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
  await waitFor(() => { if (screen.queryByRole("listbox")) throw new Error("Select is still open"); });
}
