import type { Deck } from "./model";
import { maxBuildStep } from "./presentation";

export type PresenterAction = "next" | "previous" | "first" | "last" | "exit";
export interface PresenterState {
  slideId: string;
  step: number;
  startedAt: number;
}
export type PresenterMessage =
  | { type: "ready"; needsDeck?: boolean }
  | { type: "deck"; deck: Deck; state: PresenterState }
  | { type: "state"; state: PresenterState }
  | { type: "action"; action: PresenterAction }
  | { type: "ended" };

export function presenterToken(hash: string): string | null {
  const match = /^#presenter=([a-zA-Z0-9-]{20,100})$/.exec(hash);
  return match?.[1] ?? null;
}

export function isPresenterAction(value: unknown): value is PresenterAction {
  return ["next", "previous", "first", "last", "exit"].includes(
    value as string,
  );
}

export function presenterChannelName(token: string): string {
  return `scislide.presenter.${token}`;
}

export function validatePresenterState(
  value: unknown,
  deck: Deck,
): PresenterState {
  if (!value || typeof value !== "object")
    throw new Error("Invalid presenter state.");
  const state = value as PresenterState;
  const slide = deck.slides.find((slide) => slide.id === state.slideId);
  if (
    !slide ||
    !Number.isInteger(state.step) ||
    state.step < 0 ||
    state.step > maxBuildStep(slide) ||
    !Number.isFinite(state.startedAt) ||
    state.startedAt < 0 ||
    state.startedAt > Date.now() + 60_000
  )
    throw new Error("Invalid presenter state.");
  return {
    slideId: state.slideId,
    step: state.step,
    startedAt: state.startedAt,
  };
}
