/**
 * The ambient layer: a sparse, slowly drifting composition of flat-shaded
 * polygons behind everything else.
 *
 * Rules it lives by:
 *  - **It is drawn in the same hand as the charts.** Solid theme colours, hard
 *    edges, no lighting, no fog, no alpha ramps, no soft particles. Every
 *    material is an unlit `MeshBasicMaterial`; a hollow shape is a colour plate
 *    with the flat background punched out of its middle, not a faded outline.
 *    Tone mapping is off (`<Canvas flat>`) so a `--chart-3` on the wall is
 *    exactly the `--chart-3` in the bars.
 *  - **It is decoration.** No datum is ever encoded here. The only channel from
 *    the session is `activity`, a lossy 0..1 measure of how busy the last few
 *    seconds were, and all it does is quicken the drift. It never brightens,
 *    because brightness is a data channel on this stage.
 *  - **It must not cost 60fps.** A theme puts at most two dozen quads on screen
 *    and the per-frame work is a transform write each. Device pixel ratio is
 *    capped, the depth buffer is off (draw order is pinned by `renderOrder`
 *    instead) and the loop parks entirely when the tab is hidden.
 *  - **It is theme-native, and each theme gets its own composition.** Colours
 *    and geometry are read from the live CSS tokens and the `data-theme`
 *    attribute, so a host switching `session.theme` mid-session redraws the whole
 *    arrangement.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { token } from '../theme';
import { layout, recipeFor, wrap, type ShapeKind } from './ambient-recipes';

/* ---------------------------------------------------------------- palette */

interface Palette {
  /** The five categorical hues, in token order. */
  chart: THREE.Color[];
  /** The flat field the whole stage sits on; punched out of hollow shapes. */
  background: THREE.Color;
  themeId: string;
}

const CHART_FALLBACK = ['#2563eb', '#059669', '#d97706', '#db2777', '#7c3aed'];

function readPalette(): Palette {
  const chart = CHART_FALLBACK.map(
    (fallback, i) => new THREE.Color(token(`--chart-${i + 1}`) || fallback),
  );
  const background = new THREE.Color(token('--background') || '#ffffff');
  const themeId =
    typeof document === 'undefined'
      ? 'default'
      : (document.documentElement.getAttribute('data-theme') ?? 'default');
  return { chart, background, themeId };
}

function samePalette(a: Palette, b: Palette): boolean {
  if (a.themeId !== b.themeId) return false;
  if (!a.background.equals(b.background)) return false;
  return a.chart.every((c, i) => c.equals(b.chart[i] as THREE.Color));
}

/* -------------------------------------------------------------- geometry */

/**
 * Unit geometry per shape, scaled per item. Regular polygons come from
 * `CircleGeometry` with a matching segment count — a triangle is a circle with
 * three sides, which is exactly the flat-sided result we want.
 */
function unitGeometry(kind: ShapeKind): THREE.BufferGeometry {
  switch (kind) {
    case 'triangle':
      return new THREE.CircleGeometry(0.62, 3);
    case 'hexagon':
      return new THREE.CircleGeometry(0.56, 6);
    case 'rule':
      return new THREE.PlaneGeometry(1, 0.022);
    default:
      return new THREE.PlaneGeometry(1, 1);
  }
}

/* ------------------------------------------------------------ the scene */

function Composition({ activity, palette }: { activity: number; palette: Palette }) {
  const { viewport } = useThree();
  const recipe = recipeFor(palette.themeId);

  const geometry = useMemo(() => unitGeometry(recipe.kind), [recipe.kind]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const materials = useMemo(() => {
    const flat = (color: THREE.Color): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ color: color.clone(), toneMapped: false, depthTest: false });
    return {
      hues: palette.chart.slice(0, recipe.hues).map(flat),
      background: flat(palette.background),
    };
  }, [palette, recipe.hues]);

  useEffect(
    () => () => {
      for (const m of materials.hues) m.dispose();
      materials.background.dispose();
    },
    [materials],
  );

  const items = useMemo(
    () => layout(recipe, palette.themeId, viewport.width, viewport.height),
    [recipe, palette.themeId, viewport.width, viewport.height],
  );

  const nodes = useRef<(THREE.Group | null)[]>([]);
  const eased = useRef(0);

  /**
   * Drift accumulates from the frame delta rather than from absolute time, so
   * a change in `activity` changes the *speed* without teleporting anything —
   * and a parked frameloop simply stops accumulating.
   */
  const travelled = useRef(0);
  const turned = useRef(0);

  const spanX = viewport.width + recipe.max * 2;
  const spanY = viewport.height + recipe.max * 2;
  const dirX = Math.cos(recipe.heading);
  const dirY = Math.sin(recipe.heading);

  useFrame((_state, delta) => {
    // Clamp the delta: a tab that was throttled must not fling the composition.
    const step = Math.min(delta, 0.1);
    eased.current += (activity - eased.current) * 0.04;
    const pace = 1 + eased.current * 1.1;
    travelled.current += recipe.drift * pace * step;
    turned.current += recipe.spin * pace * step;

    for (let i = 0; i < items.length; i++) {
      const node = nodes.current[i];
      const item = items[i];
      if (!node || !item) continue;
      const distance = travelled.current * item.pace;
      node.position.x = wrap(item.x + dirX * distance, spanX);
      node.position.y = wrap(item.y + dirY * distance, spanY);
      if (recipe.spin !== 0) node.rotation.z = item.rotation + turned.current * item.turn;
    }
  });

  return (
    <>
      {items.map((item, i) => {
        const material = materials.hues[item.hue % materials.hues.length] as THREE.MeshBasicMaterial;
        return (
          <group
            key={i}
            ref={(node) => {
              nodes.current[i] = node;
            }}
            position={[item.x, item.y, 0]}
            rotation={[0, 0, item.rotation]}
            scale={item.size}
          >
            <mesh geometry={geometry} material={material} renderOrder={i * 2} />
            {recipe.solid ? null : (
              <mesh
                geometry={geometry}
                material={materials.background}
                scale={1 - recipe.weight * 2}
                renderOrder={i * 2 + 1}
              />
            )}
          </group>
        );
      })}
    </>
  );
}

export default function AmbientScene({
  activity,
  visible,
}: {
  activity: number;
  visible: boolean;
}) {
  // Re-read the tokens whenever the themed attributes on <html> change, which
  // is exactly what `applyTheme` mutates on a live `session.theme` switch.
  const [palette, setPalette] = useState(readPalette);

  useEffect(() => {
    if (typeof MutationObserver !== 'function' || typeof document === 'undefined') return;
    const observer = new MutationObserver(() => {
      const next = readPalette();
      setPalette((prev) => (samePalette(prev, next) ? prev : next));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-theme-mode', 'style'],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <Canvas
      // `flat` is load-bearing: it turns off ACES tone mapping, which would
      // otherwise repaint every theme colour into a slightly different one.
      flat
      frameloop={visible ? 'always' : 'never'}
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 8], fov: 55 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power', depth: false }}
    >
      <Composition activity={activity} palette={palette} />
    </Canvas>
  );
}
