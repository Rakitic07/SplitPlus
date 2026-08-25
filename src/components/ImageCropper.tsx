import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui";

// A lightweight pan + zoom image cropper. The user drags to reposition and uses
// the slider (or mouse wheel) to zoom; the image always fully covers the fixed
// aspect frame, so the result never has empty edges. On apply it renders the
// visible crop to a capped-size JPEG data URL — same storage shape the rest of
// the app expects for thumbnails.
export function ImageCropper({
  open,
  src,
  aspect = 16 / 9,
  title = "Adjust cover photo",
  maxEdge = 1000,
  quality = 0.72,
  onCancel,
  onDone,
}: {
  open: boolean;
  src: string | null;
  aspect?: number;
  title?: string;
  maxEdge?: number;
  quality?: number;
  onCancel: () => void;
  onDone: (dataUrl: string) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // Base "cover" fit: the smallest scale at which the image fills the frame.
  const coverScale =
    frame.w && nat.w ? Math.max(frame.w / nat.w, frame.h / nat.h) : 1;
  const dispW = nat.w * coverScale * scale;
  const dispH = nat.h * coverScale * scale;

  const clamp = useCallback(
    (o: { x: number; y: number }) => {
      const minX = Math.min(0, frame.w - dispW);
      const minY = Math.min(0, frame.h - dispH);
      return {
        x: Math.max(minX, Math.min(0, o.x)),
        y: Math.max(minY, Math.min(0, o.y)),
      };
    },
    [frame.w, frame.h, dispW, dispH]
  );

  // Measure the frame (its width is fluid; height follows the aspect ratio).
  useLayoutEffect(() => {
    if (!open) return;
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setFrame({ w, h: Math.round(w / aspect) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, aspect]);

  // Load the source image to learn its natural size, then center it.
  useEffect(() => {
    if (!open || !src) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setNat({ w: img.naturalWidth, h: img.naturalHeight });
      setScale(1);
    };
    img.src = src;
  }, [open, src]);

  // Whenever the layout basis changes, re-center within the allowed bounds.
  useEffect(() => {
    if (!frame.w || !dispW) return;
    setOffset((o) => {
      // First placement (offset still at origin) → center it.
      if (o.x === 0 && o.y === 0) {
        return clamp({ x: (frame.w - dispW) / 2, y: (frame.h - dispH) / 2 });
      }
      return clamp(o);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.w, frame.h, dispW, dispH]);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.px;
    const dy = e.clientY - drag.current.py;
    setOffset(clamp({ x: drag.current.ox + dx, y: drag.current.oy + dy }));
  }
  function onPointerUp() {
    drag.current = null;
  }

  // Zoom while keeping the frame's center anchored on the same image point.
  function zoomTo(next: number) {
    const s = Math.max(1, Math.min(4, next));
    setScale((prev) => {
      if (!frame.w || !dispW) return s;
      const cx = (frame.w / 2 - offset.x) / dispW;
      const cy = (frame.h / 2 - offset.y) / dispH;
      const nDispW = nat.w * coverScale * s;
      const nDispH = nat.h * coverScale * s;
      setOffset(
        clamp({ x: frame.w / 2 - cx * nDispW, y: frame.h / 2 - cy * nDispH })
      );
      return s;
    });
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    zoomTo(scale + (e.deltaY < 0 ? 0.12 : -0.12));
  }

  function apply() {
    const img = imgRef.current;
    if (!img || !frame.w || !dispW) return;
    // Map the visible frame back onto source pixels.
    const factorX = nat.w / dispW;
    const factorY = nat.h / dispH;
    const sx = -offset.x * factorX;
    const sy = -offset.y * factorY;
    const sw = frame.w * factorX;
    const sh = frame.h * factorY;

    const outW = Math.min(maxEdge, Math.round(sw));
    const outH = Math.round(outW / aspect);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    onDone(canvas.toDataURL("image/jpeg", quality));
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <div className="flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={apply}>
            Apply
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div
          ref={frameRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          style={{ aspectRatio: String(aspect) }}
          className="relative w-full cursor-grab touch-none select-none overflow-hidden rounded-2xl bg-black/40 active:cursor-grabbing"
        >
          {src && dispW > 0 && (
            <img
              src={src}
              alt="crop"
              draggable={false}
              style={{
                position: "absolute",
                left: offset.x,
                top: offset.y,
                width: dispW,
                height: dispH,
                maxWidth: "none",
              }}
            />
          )}
          {/* Rule-of-thirds guides for easier centering */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/3 top-0 h-full w-px bg-white/20" />
            <div className="absolute left-2/3 top-0 h-full w-px bg-white/20" />
            <div className="absolute left-0 top-1/3 h-px w-full bg-white/20" />
            <div className="absolute left-0 top-2/3 h-px w-full bg-white/20" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => zoomTo(scale - 0.2)}
            className="rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={scale}
            onChange={(e) => zoomTo(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-orange-400"
          />
          <button
            type="button"
            onClick={() => zoomTo(scale + 0.2)}
            className="rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
        <p className="text-center text-xs text-white/40">
          Drag to reposition · scroll or use the slider to zoom
        </p>
      </div>
    </Modal>
  );
}
