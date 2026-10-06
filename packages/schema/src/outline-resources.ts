import type { Outline, OutlineStep } from './outline-types.js';

export interface OutlineResourceSource { url?: string; assetId?: string; resourceId?: string }
export type OutlineResourceMapper = <T extends OutlineResourceSource>(source: T, path: string) => T;

/** The document's complete media graph, shared by file editing, export and live launch. */
export function mapOutlineResourceSources(outline: Outline, map: OutlineResourceMapper): Outline {
  return {
    ...outline,
    ...(outline.design ? { design: {
      ...outline.design,
      masters: outline.design.masters.map((master, index) => ({
        ...master,
        ...(master.background?.kind === 'image' ? { background: map(master.background, `/design/masters/${index}/background`) } : {}),
        ...(master.logo ? { logo: map(master.logo, `/design/masters/${index}/logo`) } : {}),
      })),
    } } : {}),
    steps: outline.steps.map((step, index): OutlineStep => {
      const path = `/steps/${index}`;
      return {
        ...step,
        ...(step.design?.background?.kind === 'image' ? { design: { ...step.design, background: map(step.design.background, `${path}/design/background`) } } : {}),
        ...('media' in step && step.media ? { media: map(step.media, `${path}/media`) } : {}),
        ...('elements' in step && step.elements ? { elements: step.elements.map((element, at) =>
          element.type === 'image' || element.type === 'pdf' ? map(element, `${path}/elements/${at}`) : element,
        ) } : {}),
      } as OutlineStep;
    }),
  };
}
