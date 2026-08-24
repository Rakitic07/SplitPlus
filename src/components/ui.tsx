import {
  forwardRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { cn, colorForName, initials } from "@/lib/utils";

export function Card({
  children,
  className,
  strong,
}: {
  children: ReactNode;
  className?: string;
  strong?: boolean;
}) {
  return (
    <div className={cn(strong ? "glass-strong" : "glass", "rounded-3xl", className)}>{children}</div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "primary", loading, disabled, className, children, ...rest },
  ref
) {
  const base =
    variant === "primary" ? "glass-btn-primary" : variant === "danger" ? "glass-btn" : "glass-btn";
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        base,
        variant === "danger" && "!text-red-300 hover:!text-red-200",
        className
      )}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn("glass-input", className)} {...rest} />;
  }
);

// A passphrase input with a show/hide toggle — so people can actually see what
// they typed (a common ask on the recovery flow).
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type">
>(function PasswordInput({ className, ...rest }, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        ref={ref}
        type={show ? "text" : "password"}
        className={cn("glass-input pr-11", className)}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/50 transition hover:text-white"
        aria-label={show ? "Hide passphrase" : "Show passphrase"}
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-white/70">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-white/40">{hint}</span>}
    </label>
  );
}

export function Avatar({
  name,
  src,
  size = 40,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        style={{ width: size, height: size }}
        className={cn("rounded-full object-cover ring-1 ring-white/20", className)}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${colorForName(name)}, ${colorForName(name)}99)`,
        fontSize: size * 0.4,
      }}
      className={cn(
        "flex items-center justify-center rounded-full font-bold text-white ring-1 ring-white/20",
        className
      )}
    >
      {initials(name)}
    </div>
  );
}

export function Pill({
  active,
  children,
  className,
  color,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; color?: string }) {
  return (
    <button
      className={cn(
        "pill transition",
        active ? "!border-white/50 text-white" : "text-white/60 hover:text-white/90",
        className
      )}
      style={active && color ? { borderColor: color, background: `${color}33` } : undefined}
      {...rest}
    >
      {children}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-4xl opacity-80">{icon}</div>}
      <div className="text-lg font-semibold text-white/90">{title}</div>
      {subtitle && <div className="max-w-xs text-sm text-white/50">{subtitle}</div>}
      {action}
    </div>
  );
}

export function AvatarStack({
  people,
  max = 4,
  size = 28,
  showOverflow = true,
}: {
  people: { name: string; avatar?: string | null }[];
  max?: number;
  size?: number;
  // When false, only up to `max` avatars render (no "+N" count badge).
  showOverflow?: boolean;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((p, i) => (
        <div key={i} style={{ marginLeft: i === 0 ? 0 : -size * 0.3 }}>
          <Avatar name={p.name} src={p.avatar} size={size} className="ring-2 ring-[#0b0d1c]" />
        </div>
      ))}
      {showOverflow && extra > 0 && (
        <div
          style={{ width: size, height: size, marginLeft: -size * 0.3, fontSize: size * 0.36 }}
          className="flex items-center justify-center rounded-full bg-white/15 font-semibold text-white/80 ring-2 ring-[#0b0d1c]"
        >
          +{extra}
        </div>
      )}
    </div>
  );
}
