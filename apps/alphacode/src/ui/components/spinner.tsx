import { NativeImagePool, RGBA, resolveImageRenderProtocol, type ImageRenderable, type ImageRenderProtocol } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useMotion } from "../motion";
import { colors } from "../theme";
import { brailleMorph, morphingInfinity, rasterMorph } from "../morphing-infinity";

function MorphingImage(props: { elapsed: number; color: string; protocol: ImageRenderProtocol; onError: () => void }) {
  const renderer = useRenderer();
  let node: ImageRenderable | undefined;
  const pool = new NativeImagePool({ width: morphingInfinity.width, height: morphingInfinity.height, capacity: 3, owner: renderer.nativeScene.resourceContext });
  onCleanup(() => pool.dispose());
  createEffect(() => {
    const coverage = rasterMorph(props.elapsed), color = RGBA.fromHex(props.color).toInts();
    if (!node) return;
    try {
      const pixels = new Uint8Array(coverage.length * 4);
      coverage.forEach((alpha, i) => pixels.set([color[0], color[1], color[2], alpha], i * 4));
      const frame = pool.publishRgba(pixels);
      if (frame) {
        // ImageRenderable retains its own frame synchronously, then releases the previous one after loading.
        try { node.source = frame; } finally { frame.dispose(); }
      }
    } catch { props.onError(); }
  });
  return <image id="activity-spinner-image" ref={value => { node = value; }} width={morphingInfinity.columns} height={1}
    fit="fit" protocol={props.protocol} onError={props.onError} />;
}

export function Spinner(props: { active: boolean; color?: string }) {
  const renderer = useRenderer();
  const moving = useMotion(() => props.active);
  const [elapsed, setElapsed] = createSignal(0);
  const [imageFailed, setImageFailed] = createSignal(false);
  const readProtocol = () => process.env.NO_COLOR !== undefined ? "blocks" : resolveImageRenderProtocol("auto", renderer.capabilities, Boolean(renderer.resolution?.width && renderer.resolution.height));
  const [protocol, setProtocol] = createSignal<Exclude<ImageRenderProtocol, "auto">>(readProtocol());
  const updateProtocol = () => setProtocol(readProtocol());
  // Pixel-resolution replies can arrive after capabilities; the next frame observes them.
  renderer.on("frame", updateProtocol);
  renderer.on("capabilities", updateProtocol);
  onCleanup(() => { renderer.off("frame", updateProtocol); renderer.off("capabilities", updateProtocol); });
  createEffect(() => {
    setElapsed(0);
    if (!moving()) return;
    const started = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - started), morphingInfinity.frameMs);
    onCleanup(() => clearInterval(timer));
  });
  return <box id="activity-spinner" width={morphingInfinity.columns} height={1} flexShrink={0}>
    <Show when={protocol() !== "blocks" && !imageFailed()} fallback={
      <text id="activity-spinner-dots" width={morphingInfinity.columns} height={1} fg={props.color ?? colors.muted}>{brailleMorph(elapsed())}</text>
    }>
      <MorphingImage elapsed={elapsed()} color={props.color ?? colors.muted} protocol={protocol()} onError={() => setImageFailed(true)} />
    </Show>
  </box>;
}
