/* Multica detail surfaces, adapted to scoped styles. See public/third-party/multica. */
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "@/i18n/react";
import type {
  TraceDiffLine,
  TraceEventDetail,
} from "./vendor/trace-event-presenter";

function useHighlight(text: string, path?: string) {
  const [result, setResult] = useState<{
    text: string;
    path: string;
    lines: string[] | null;
  }>();
  useEffect(() => {
    let active = true;
    if (!path) return;
    void import("./vendor/diff-highlight")
      .then((module) => {
        const language = module.languageForPath(path);
        if (active)
          setResult({
            text,
            path,
            lines: language ? module.highlightToLines(text, language) : null,
          });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [text, path]);
  return result?.text === text && result.path === path ? result.lines : null;
}

function ClipSurface({
  text,
  children,
  className = "",
}: {
  text: string;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const clipped =
    !expanded && (text.length > 1600 || text.split("\n").length > 14);
  return (
    <div className={`detail-surface ${clipped ? "long" : ""} ${className}`}>
      {children}
      {clipped && (
        <div className="show-all">
          <button type="button" onClick={() => setExpanded(true)}>
            {t("traces:show_all")}
          </button>
        </div>
      )}
    </div>
  );
}
export function TextSurface({ text, path }: { text: string; path?: string }) {
  const lines = useHighlight(text, path);
  return (
    <ClipSurface text={text}>
      <pre className="transcript-code">
        {lines ? (
          <code
            className="hljs"
            dangerouslySetInnerHTML={{ __html: lines.join("\n") }}
          />
        ) : (
          text
        )}
      </pre>
    </ClipSurface>
  );
}
function DiffSurface({
  path,
  lines,
}: {
  path: string;
  lines: TraceDiffLine[];
}) {
  const additions = lines.filter((l) => l.kind === "add").length,
    removals = lines.filter((l) => l.kind === "remove").length;
  const highlighted = {
    add: useHighlight(
      lines
        .filter((l) => l.kind === "add")
        .map((l) => l.text)
        .join("\n"),
      path,
    ),
    remove: useHighlight(
      lines
        .filter((l) => l.kind === "remove")
        .map((l) => l.text)
        .join("\n"),
      path,
    ),
    context: useHighlight(
      lines
        .filter((l) => l.kind === "context")
        .map((l) => l.text)
        .join("\n"),
      path,
    ),
  };
  const cursor = { add: 0, remove: 0, context: 0 };
  return (
    <ClipSurface text={lines.map((l) => l.text).join("\n")} className="diff">
      <div className="diff-count">
        {additions > 0 && <span className="success">+{additions}</span>}
        {removals > 0 && <span className="error">-{removals}</span>}
      </div>
      <pre className="transcript-code">
        {lines.map((line, i) => {
          if (line.kind === "gap")
            return (
              <div key={i} className="faint" aria-hidden>
                {"  ⋯"}
              </div>
            );
          const html = highlighted[line.kind]?.[cursor[line.kind]++];
          return (
            <div
              key={i}
              className={`diff-line ${line.kind} ${html ? "highlighted" : ""}`}
            >
              <span
                aria-hidden
                className={
                  line.kind === "add"
                    ? "success"
                    : line.kind === "remove"
                      ? "error"
                      : ""
                }
              >
                {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
              </span>{" "}
              {html === undefined ? (
                line.text
              ) : (
                <span
                  className="hljs"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              )}
            </div>
          );
        })}
      </pre>
    </ClipSurface>
  );
}
export function DetailSurface({ detail }: { detail: TraceEventDetail }) {
  const { t } = useTranslation();
  switch (detail.kind) {
    case "text":
      return <TextSurface text={detail.text} />;
    case "diff":
      return <DiffSurface path={detail.path} lines={detail.lines} />;
    case "file":
      return (
        <>
          <div className="diff-count success">+{detail.lineCount}</div>
          <TextSurface text={detail.text} path={detail.path} />
        </>
      );
    case "patch":
      return (
        <>
          {detail.files.map((file, i) => (
            <div key={`${file.path}:${i}`}>
              {file.body.kind === "diff" ? (
                <DiffSurface path={file.path} lines={file.body.lines} />
              ) : (
                <>
                  <div className="diff-path">
                    {file.path}
                    {file.movePath && ` → ${file.movePath}`}
                  </div>
                  <TextSurface
                    path={file.body.kind === "file" ? file.path : undefined}
                    text={
                      file.body.kind === "file"
                        ? file.body.text
                        : t("traces:patch_no_content")
                    }
                  />
                </>
              )}
              {file.truncated && (
                <p className="tool-detail-note">
                  {t("traces:patch_body_truncated")}
                </p>
              )}
            </div>
          ))}
          {detail.truncated && (
            <p className="tool-detail-note">{t("traces:patch_truncated")}</p>
          )}
        </>
      );
  }
}
