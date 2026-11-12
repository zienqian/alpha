import { fireEvent } from "@testing-library/react";

// Exercise the actual contenteditable's selection and Markdown paste handling.
export function replaceDraft(element: HTMLElement, text: string) {
  element.focus();
  fireEvent.keyDown(element, { key: "a", code: "KeyA", ctrlKey: true });
  if (text) {
    fireEvent.paste(element, { clipboardData: {
      getData: (type: string) => type === "text/plain" ? text : "",
      files: [], types: ["text/plain"],
    } });
  } else {
    fireEvent.keyDown(element, { key: "Backspace", code: "Backspace" });
  }
}
