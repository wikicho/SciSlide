import { useEffect, useRef, useState } from "react";
import type { Asset, VideoObject } from "../lib/model";

/** A passive frame in the editor; media is mounted only during presentation. */
export function VideoPlaceholder({
  object,
  missing = false,
}: {
  object: VideoObject;
  missing?: boolean;
}) {
  const { width, height } = object.transform;
  const size = Math.max(4, Math.min(width, height) * 0.18);
  return (
    <g aria-label={object.alt || object.name}>
      <rect width={width} height={height} rx="12" fill="#172033" />
      <path
        d={`M ${width / 2 - size / 3} ${height / 2 - size / 2} L ${width / 2 + size / 2} ${height / 2} L ${width / 2 - size / 3} ${height / 2 + size / 2} Z`}
        fill="#e2e8f0"
      />
      <text
        x={width / 2}
        y={height * 0.82}
        textAnchor="middle"
        fill="#cbd5e1"
        fontFamily="Inter"
        fontSize={Math.min(22, width / 18, height / 10)}
      >
        {missing ? "Missing video" : "Video · play in presentation"}
      </text>
      <title>{object.alt || object.name}</title>
    </g>
  );
}

export function VideoView({
  object,
  asset,
}: {
  object: VideoObject;
  asset: Asset;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsPlay, setNeedsPlay] = useState(!object.autoplay);
  const [error, setError] = useState("");
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let active = true;
    setError("");
    setNeedsPlay(!object.autoplay);
    if (object.autoplay) {
      void video.play().catch(() => {
        // Autoplay may require a fresh user gesture, especially with audio.
        if (active) setNeedsPlay(true);
      });
    }
    return () => {
      active = false;
      video.pause();
    };
  }, [asset.dataUrl, object.autoplay]);

  const play = () => {
    const video = videoRef.current;
    if (!video) return;
    void video.play().catch(() => {
      setError("Playback could not start. Check this video's codec.");
      setNeedsPlay(true);
    });
  };

  return (
    <foreignObject
      width={object.transform.width}
      height={object.transform.height}
    >
      <div
        className="video-player"
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") event.stopPropagation();
        }}
      >
        <video
          ref={videoRef}
          src={asset.dataUrl}
          aria-label={object.alt || object.name}
          preload="metadata"
          playsInline
          muted={object.muted}
          loop={object.loop}
          controls={object.controls}
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          onPlay={() => setNeedsPlay(false)}
          onPause={() => setNeedsPlay(true)}
          onEnded={() => setNeedsPlay(true)}
          onError={() => {
            setError(
              "This video cannot be decoded. Use an MP4 or WebM codec supported by this app.",
            );
          }}
        />
        {needsPlay && !error && (
          <button
            type="button"
            className="video-play-action"
            onClick={play}
            aria-label={`Play ${object.name}`}
          >
            Play video
          </button>
        )}
        {error && (
          <div className="video-playback-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </foreignObject>
  );
}
