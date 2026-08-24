import { cn } from "@/lib/utils";

// A block skeleton with a light sweep — for loading placeholders.
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-xl", className)} />;
}

// Text that shimmers while something is loading (e.g. "Loading balances…").
export function ShimmerText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn("shimmer-text font-semibold", className)}>{children}</span>;
}

// A heading whose light band only sweeps on hover — a subtle premium affordance.
export function ShimmerHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn("shimmer-hover", className)}>{children}</span>;
}

// A placeholder for one expense/list row.
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-2 py-3">
      <Skeleton className="h-11 w-11 rounded-2xl" />
      <div className="flex-1">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="mt-2 h-3 w-1/3" />
      </div>
      <Skeleton className="h-4 w-14" />
    </div>
  );
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

// A placeholder card for the groups grid.
export function SkeletonCard() {
  return (
    <div className="glass rounded-3xl p-4">
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="mt-3 h-4 w-2/3" />
      <Skeleton className="mt-2 h-3 w-1/3" />
    </div>
  );
}
