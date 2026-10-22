import { existsSync } from "node:fs";
import { GlobalFonts } from "@napi-rs/canvas";

const FONT_CANDIDATES = [
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
];

let fontFamily = "sans-serif";
let registered = false;

export function canvasFont(): string {
  if (registered) return fontFamily;
  registered = true;
  for (const path of FONT_CANDIDATES) {
    if (!existsSync(path)) continue;
    try {
      GlobalFonts.registerFromPath(path, "Siela");
      fontFamily = "Siela";
      return fontFamily;
    } catch {
      // keep trying
    }
  }
  return fontFamily;
}
