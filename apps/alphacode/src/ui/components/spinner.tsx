import { NativeImagePool, RGBA, resolveImageRenderProtocol, type ImageRenderable, type ImageRenderProtocol } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMotion } from "../motion";
import { colors } from "../theme";
import { brailleMorph, morphingInfinity, rasterMorph } from "../morphing-infinity";

function MorphingImage(props: { elapsed: number; color: string; protocol: ImageRenderProtocol; onError: () => void }) {
  const renderer = useRenderer();
  const node = useRef<ImageRenderable>(null);
  const pool = useRef<NativeImagePool | null>(null);
  useLayoutEffect(() => {
    const images = new NativeImagePool({ width: morphingInfinity.width, height: morphingInfinity.height, capacity: 3, owner: renderer.nativeScene.resourceContext });
    pool.current = images;
    return () => { pool.current = null; images.dispose(); };
  }, [renderer]);
  useLayoutEffect(() => {
    const coverage = rasterMorph(props.elapsed), color = RGBA.fromHex(props.color).toInts();
    if (!node.current || !pool.current) return;
    try {
      const pixels = new Uint8Array(coverage.length * 4);
      coverage.forEach((alpha, index) => pixels.set([color[0], color[1], color[2], alpha], index * 4));
      const frame = pool.current.publishRgba(pixels);
      if (frame) {
        // ImageRenderable retains its own frame synchronously, then releases the previous one after loading.
        try { node.current.source = frame; } finally { frame.dispose(); }
      }
    } catch { props.onError(); }
  }, [props.elapsed, props.color, props.onError, renderer]);
  return <image id="activity-spinner-image" ref={node} width={morphingInfinity.columns} height={1}
    fit="fit" protocol={props.protocol} onError={props.onError} />;
}

export function Spinner(props: { active: boolean; color?: string }) {
  const renderer = useRenderer();
  const moving = useMotion(props.active);
  const [elapsed, setElapsed] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const onImageError = useCallback(() => setImageFailed(true), []);
  const readProtocol = useCallback(() => process.env.NO_COLOR !== undefined ? "blocks" : resolveImageRenderProtocol("auto", renderer.capabilities, Boolean(renderer.resolution?.width && renderer.resolution.height)), [renderer]);
  const [protocol, setProtocol] = useState<Exclude<ImageRenderProtocol, "auto">>(readProtocol);
  // Pixel-resolution replies can arrive after capabilities; the next frame observes them.
  useEffect(() => {
    const updateProtocol = () => setProtocol(readProtocol());
    updateProtocol();
    renderer.on("frame", updateProtocol);
    renderer.on("capabilities", updateProtocol);
    return () => { renderer.off("frame", updateProtocol); renderer.off("capabilities", updateProtocol); };
  }, [renderer, readProtocol]);
  useEffect(() => {
    setElapsed(0);
    if (!moving) return;
    const started = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - started), morphingInfinity.frameMs);
    return () => clearInterval(timer);
  }, [moving]);
  return <box id="activity-spinner" width={morphingInfinity.columns} height={1} flexShrink={0}>
    {protocol !== "blocks" && !imageFailed ? (
      <MorphingImage elapsed={elapsed} color={props.color ?? colors.muted} protocol={protocol} onError={onImageError} />
    ) : (
      <text id="activity-spinner-dots" width={morphingInfinity.columns} height={1} fg={props.color ?? colors.muted}>{brailleMorph(elapsed)}</text>
    )}
  </box>;
}
