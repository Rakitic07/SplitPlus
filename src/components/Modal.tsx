import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// Open modals, innermost last. Escape and the body scroll lock belong to the
// stack as a whole, so closing a nested modal (camera, cropper) leaves its
// parent modal and the locked page untouched.
const stack: symbol[] = [];

function useModalLayer(open: boolean, onClose: () => void, panelRef: RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const me = Symbol("modal");
    stack.push(me);
    document.body.style.overflow = "hidden";
    const restoreFocus = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === me) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(me), 1);
      if (stack.length === 0) document.body.style.overflow = "";
      restoreFocus?.focus?.({ preventScroll: true });
    };
  }, [open, panelRef]);
}

/** Full-screen view of a single image (e.g. a profile photo). Tap anywhere to close. */
export function ImageViewer({
  open,
  onClose,
  src,
  alt,
  fallback,
}: {
  open: boolean;
  onClose: () => void;
  src?: string | null;
  alt: string;
  /** Shown instead of the image when there's no `src` (e.g. initials). */
  fallback?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalLayer(open, onClose, panelRef);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          tabIndex={-1}
          onClick={onClose}
          className="fixed inset-0 z-50 flex cursor-zoom-out flex-col items-center justify-center gap-4 bg-black/85 p-6 outline-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="pt-safe absolute right-3 top-3 rounded-full p-2.5 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-6 w-6" />
          </button>
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", damping: 24, stiffness: 280 }}
            className="aspect-square w-[min(88vw,72vh,560px)] overflow-hidden rounded-[2.5rem] shadow-2xl ring-1 ring-white/15"
          >
            {src ? (
              <img src={src} alt={alt} className="h-full w-full object-cover" draggable={false} />
            ) : (
              fallback
            )}
          </motion.div>
          <div className="text-lg font-semibold text-white/85">{alt}</div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalLayer(open, onClose, panelRef);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            className={`glass-strong relative w-full outline-none ${
              wide ? "sm:max-w-2xl" : "sm:max-w-md"
            } max-h-[92vh] overflow-y-auto rounded-t-4xl sm:rounded-4xl`}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
          >
            {/* Solid (not translucent) bars: nested backdrop-blur inside the
                glass panel is ignored by browsers, so scrolled content would
                otherwise show straight through the sticky header/footer. */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-panel/95 px-5 py-4">
              <div id={titleId} className="text-lg font-bold text-white">
                {title}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-m-1 rounded-full p-2.5 text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-4">{children}</div>
            {footer && (
              <div className="sticky bottom-0 z-10 border-t border-white/10 bg-panel/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
