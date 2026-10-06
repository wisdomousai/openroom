import { Component, Suspense, lazy, type ReactNode } from 'react';

/**
 * The ambient layer's front door.
 *
 * `three` and `@react-three/fiber` are behind a dynamic `import()` that only
 * resolves when this component actually renders a scene. A projector-theme
 * session, a reduced-motion projector and a machine without WebGL therefore never
 * pay a byte for the atmosphere they are not getting — the decision lives in
 * `shouldRenderAmbient()` and is made before this ever mounts.
 */
const AmbientScene = lazy(() => import('./ambient-scene'));

export interface AmbientProps {
  /** Result of `shouldRenderAmbient()`. False renders nothing at all. */
  active: boolean;
  /** 0..1 session busyness. Brightens and quickens the field, carries no data. */
  activity: number;
  /** False while the tab is hidden — parks the render loop. */
  visible: boolean;
}

export function AmbientLayer({ active, activity, visible }: AmbientProps) {
  if (!active) return null;
  return (
    <div className="ambient" aria-hidden="true">
      <AmbientBoundary>
        <Suspense fallback={null}>
          <AmbientScene activity={activity} visible={visible} />
        </Suspense>
      </AmbientBoundary>
    </div>
  );
}

/**
 * A lost context, a driver crash or a chunk that failed to load must never take
 * the results down with it — the atmosphere is the most disposable thing on the
 * stage, so it fails to nothing.
 */
class AmbientBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
