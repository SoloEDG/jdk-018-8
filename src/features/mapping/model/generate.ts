import type {
  StudioDocument,
  Grid,
  Asset,
  Crop,
  Settings,
} from "../../../shared/document";
import { glyphs } from "../lib/charsets";
import { gridSize } from "../lib/gridSize";
import { sample } from "../lib/sample";
import { tone, luminance } from "../lib/tone";

export function generateFrom(
  asset: Asset,
  crop: Crop,
  settings: Settings,
  revision = 0,
): Grid {
  const size = gridSize(
    asset.width * crop.width,
    asset.height * crop.height,
    settings.columns,
  );
  const pixels = sample(
    asset,
    crop,
    size.columns,
    size.rows,
    settings.background,
  );
  const chars = glyphs(settings.charset, settings.custom);
  const cells = [];
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!,
      g = pixels[i + 1]!,
      b = pixels[i + 2]!;
    const t = tone(
      luminance(r, g, b),
      settings.contrast,
      settings.gamma,
      settings.invert,
    );
    cells.push({
      glyph: chars[Math.round(t * (chars.length - 1))]!,
      color:
        "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""),
    });
  }
  return { ...size, cells, revision };
}

export function generate(doc: StudioDocument): Grid | null {
  if (!doc.asset) return null;
  return generateFrom(doc.asset, doc.crop, doc.settings, doc.revision);
}
