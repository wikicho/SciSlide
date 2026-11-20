import { useEffect } from "react";
import { SlideScene } from "./SlideScene";
import { usePresentationReceiver } from "./usePresentationReceiver";

export function AudienceApp({ token }: { token: string }) {
  const { deck, state, ended, send } = usePresentationReceiver(token);
  useEffect(() => {
    // Some browsers consume Escape themselves when leaving DOM fullscreen.
    let showingFullscreen =
      document.fullscreenElement === document.documentElement;
    const onChange = () => {
      if (!document.fullscreenElement && showingFullscreen) send("exit");
      showingFullscreen =
        document.fullscreenElement === document.documentElement;
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [send]);
  const slideIndex =
    deck?.slides.findIndex((slide) => slide.id === state?.slideId) ?? -1;
  return (
    <main
      className="audience-view"
      aria-label="Audience display"
      onDoubleClick={(event) => {
        if (
          document.fullscreenElement ||
          (event.target instanceof Element &&
            event.target.closest(
              "button, input, a, video, audio, .video-player",
            ))
        )
          return;
        void document.documentElement.requestFullscreen?.().catch(() => {});
      }}
    >
      {!ended && deck && state && slideIndex >= 0 && (
        <SlideScene
          key={state.slideId}
          deck={deck}
          slide={deck.slides[slideIndex]}
          slideIndex={slideIndex}
          presentationStep={state.step}
          playback
        />
      )}
    </main>
  );
}
