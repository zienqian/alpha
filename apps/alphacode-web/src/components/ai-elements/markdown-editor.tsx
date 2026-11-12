import { useEffect, useRef, useState } from "react";
import { Marked, type marked } from "marked";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorState } from "@tiptap/pm/state";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  canSend: boolean;
  label: string;
  placeholder: string;
  focusRequest: number;
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  const current = useRef(props);
  current.current = props;
  const lastValue = useRef(props.value);
  const editorRef = useRef<Editor | null>(null);
  // Keep parser extensions isolated per editor and HTML source literal in coding prompts.
  const [parser] = useState(() => new Marked({
    gfm: true, breaks: true,
    tokenizer: { html: () => undefined, tag: () => undefined },
  }));
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        underline: false,
        trailingNode: false,
        link: { openOnClick: false, autolink: false, linkOnPaste: false },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false, renderWrapper: true } }),
      Image.configure({ inline: true, allowBase64: false }),
      // Tiptap types this option as the global callable, but uses the shared Marked instance API.
      Markdown.configure({ marked: parser as unknown as typeof marked }),
      Placeholder.configure({ placeholder: () => current.current.placeholder }),
    ],
    content: props.value,
    contentType: "markdown",
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": props.label,
        "aria-multiline": "true",
        "aria-describedby": "composer-status",
        "data-slot": "input-group-control",
        class: "markdown composer-editor min-h-20 max-h-48 w-full overflow-y-auto px-4 pt-3.5 pb-2 text-base leading-6 outline-none md:text-sm md:leading-6",
      },
      handleDOMEvents: {
        keydown(view, event) {
          if (event.key !== "Enter") return false;
          // Let the IME confirm text without running ProseMirror's Enter commands or sending.
          if (view.composing || event.isComposing || event.keyCode === 229) return true;
          event.preventDefault();
          if (event.shiftKey) {
            // Use the editor's normal Enter behavior for paragraphs, lists and fenced code.
            editorRef.current?.commands.keyboardShortcut("Enter");
          } else if (current.current.canSend) {
            current.current.onSend();
          }
          return true;
        },
      },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain");
        const active = editorRef.current;
        if (!text || !active) return false;
        if (!text.trim() || view.state.selection.$from.parent.type.spec.code) {
          view.dispatch(view.state.tr.insertText(text).scrollIntoView());
        } else if (event.clipboardData?.getData("text/html").includes("data-pm-slice")) {
          // Preserve formatted selections copied from this editor using ProseMirror's slice.
          return false;
        } else {
          active.commands.insertContent(text, { contentType: "markdown" });
        }
        return true;
      },
    },
    onUpdate({ editor: updated }) {
      const value = updated.isEmpty ? "" : updated.getMarkdown();
      lastValue.current = value;
      current.current.onChange(value);
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    if (!editor || props.value === lastValue.current) return;
    lastValue.current = props.value;
    editor.commands.setContent(props.value, { contentType: "markdown", emitUpdate: false });
    // Accepted sends and externally restored drafts start a fresh undo history.
    editor.view.updateState(EditorState.create({
      schema: editor.schema, doc: editor.state.doc, plugins: editor.state.plugins,
    }));
  }, [editor, props.value]);

  useEffect(() => {
    if (!editor) return;
    editor.setOptions({ editorProps: {
      ...editor.options.editorProps,
      attributes: { ...editor.options.editorProps.attributes, "aria-label": props.label },
    } });
    // Refresh placeholder decorations after language or queue-state changes.
    editor.view.dispatch(editor.state.tr);
  }, [editor, props.label, props.placeholder]);

  useEffect(() => {
    if (editor && props.focusRequest > 0) editor.view.focus();
  }, [editor, props.focusRequest]);

  return <EditorContent editor={editor} className="w-full min-w-0" />;
}
