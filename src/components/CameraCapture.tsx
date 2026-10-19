import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui";

// Webcam capture for desktop browsers (phones use the native camera via the
// file input's `capture` attribute instead). Resolves the snapshot as a File so
// it goes through the same thumbnail pipeline as an uploaded image.
export function CameraCapture({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active: MediaStream | null = null;
    let cancelled = false;
    setErr(null);
    setStream(null);
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: facing }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        active = s;
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => setErr("Camera unavailable. Allow camera access in your browser, or attach a file instead."));
    if (!navigator.mediaDevices) setErr("This browser doesn't support camera access.");
    return () => {
      cancelled = true;
      active?.getTracks().forEach((t) => t.stop());
    };
  }, [open, facing]);

  function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg" }));
        onClose();
      },
      "image/jpeg",
      0.9
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Take a photo"
      footer={
        <div className="flex gap-3">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
            disabled={!!err}
          >
            <RefreshCw className="h-4 w-4" /> Flip
          </Button>
          <Button className="flex-1" onClick={snap} disabled={!stream}>
            <Camera className="h-4 w-4" /> Capture
          </Button>
        </div>
      }
    >
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl bg-black">
        {err ? (
          <p className="px-6 text-center text-sm text-white/60">{err}</p>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
            {!stream && <Loader2 className="absolute h-6 w-6 animate-spin text-white/60" />}
          </>
        )}
      </div>
    </Modal>
  );
}
