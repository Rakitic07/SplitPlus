// A warm near-black radial base plus three soft, slowly-floating colour blobs
// (orange / gold / gray). Fixed behind everything so the glass panels always sit
// on the same living backdrop.
export function Background() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{
        background:
          "radial-gradient(125% 125% at 50% 8%, #1c1508 0%, #0a0805 55%, #050403 100%)",
      }}
    >
      <div
        className="bg-blob absolute -left-24 -top-24 h-[46vh] w-[46vh] rounded-full blur-3xl animate-float"
        style={{ background: "radial-gradient(circle, rgba(255,138,61,0.32), transparent 70%)" }}
      />
      <div
        className="bg-blob absolute -right-24 top-24 h-[50vh] w-[50vh] rounded-full blur-3xl animate-float"
        style={{
          background: "radial-gradient(circle, rgba(255,194,61,0.26), transparent 70%)",
          animationDelay: "-3s",
        }}
      />
      <div
        className="bg-blob absolute -bottom-32 left-1/3 h-[52vh] w-[52vh] rounded-full blur-3xl animate-float"
        style={{
          background: "radial-gradient(circle, rgba(154,160,173,0.20), transparent 70%)",
          animationDelay: "-6s",
        }}
      />
    </div>
  );
}
