// A warm near-black radial base plus three soft colour glows (orange / gold /
// gray), fixed behind everything so the glass panels always sit on the same
// backdrop. Painted as one static layer of gradients: no filter blur and no
// animation, so the page never has to repaint it.
export function Background() {
  return (
    <div
      aria-hidden
      className="app-backdrop pointer-events-none fixed inset-0 -z-10"
      style={{
        background: [
          "radial-gradient(48vmax 48vmax at 4% 2%, rgba(255,138,61,0.22), transparent 62%)",
          "radial-gradient(52vmax 52vmax at 100% 30%, rgba(255,194,61,0.17), transparent 62%)",
          "radial-gradient(54vmax 54vmax at 45% 108%, rgba(154,160,173,0.13), transparent 62%)",
          "radial-gradient(125% 125% at 50% 8%, #1c1508 0%, #0a0805 55%, #050403 100%)",
        ].join(","),
      }}
    />
  );
}
