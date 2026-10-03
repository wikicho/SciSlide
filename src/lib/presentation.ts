import type { BaseSlideObject, Slide } from "./model";

/** Hidden objects never extend the live presentation's build sequence. */
export function maxBuildStep(slide: Slide): number {
  return slide.objects.reduce(
    (last, object) =>
      object.visible ? Math.max(last, object.build?.step ?? 0) : last,
    0,
  );
}

export const lastBuildStep = maxBuildStep;

/** Editors and static exports show the final state; live presentation passes a step. */
export function isVisibleAtStep(
  object: BaseSlideObject,
  step?: number,
): boolean {
  return (
    object.visible && (step === undefined || (object.build?.step ?? 0) <= step)
  );
}

function buildSteps(slide: Slide): number[] {
  return [
    ...new Set([
      0,
      ...slide.objects
        .filter((object) => object.visible)
        .map((object) => object.build?.step ?? 0),
    ]),
  ].sort((a, b) => a - b);
}

/** Navigate populated steps only, so a build numbered 100 still needs one click. */
export function nextBuildStep(slide: Slide, current: number): number | null {
  return buildSteps(slide).find((step) => step > current) ?? null;
}

export function previousBuildStep(
  slide: Slide,
  current: number,
): number | null {
  return (
    buildSteps(slide)
      .reverse()
      .find((step) => step < current) ?? null
  );
}
