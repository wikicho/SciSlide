import { useMemo } from "react";
import type { Asset } from "../lib/model";
import { getFigureExportWarnings } from "../lib/figure-export-compatibility";

export function FigureExportNotice({ asset }: { asset?: Asset }) {
  const warnings = useMemo(() => {
    if (!asset) return [];
    try {
      return getFigureExportWarnings(asset);
    } catch (error) {
      return [(error as Error).message];
    }
  }, [asset]);
  if (!warnings.length) return null;
  return (
    <div
      className="figure-export-notice"
      role="note"
      aria-label="Figure export compatibility"
    >
      <strong>Export compatibility</strong>
      <ul>
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}
