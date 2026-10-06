/** Shared animation preference used by the TanStack chart definitions (STAGE-10). */
export function chartMotion(reduced?: boolean): {
  isAnimationActive: boolean;
  animationDuration: number;
} {
  const still = reduced === true;
  return {
    isAnimationActive: !still,
    animationDuration: still ? 0 : 550,
  };
}
