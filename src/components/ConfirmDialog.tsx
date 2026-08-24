import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui";

// A theme-matched confirm dialog to replace the browser's native confirm(),
// so destructive actions (delete/leave group) get a proper, on-brand prompt.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1 justify-center" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={loading}
            className={danger ? "flex-1 justify-center !bg-rose-500/90 !text-white hover:!bg-rose-500" : "flex-1 justify-center"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        {danger && (
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-300">
            <AlertTriangle className="h-5 w-5" />
          </span>
        )}
        <p className="text-sm leading-relaxed text-white/70">{message}</p>
      </div>
    </Modal>
  );
}
