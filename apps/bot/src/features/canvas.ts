import { existsSync } from "node:fs";
import { GlobalFonts } from "@napi-rs/canvas";

const FONT_CANDIDATES = [
  {
    regular: "C:/Windows/Fonts/segoeui.ttf",
    bold: "C:/Windows/Fonts/segoeuib.ttf",
  },
  {
    regular: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    bold: "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  },
  {
    regular: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    bold: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  },
  {
    regular: "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc",
    bold: "/usr/share/fonts/noto/NotoSansCJK-Bold.ttc",
  },
  {
    regular: "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    bold: "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  },
  {
    regular: "/System/Library/Fonts/Supplemental/Arial.ttf",
    bold: "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  },
];

let regularFamily = "sans-serif";
let boldFamily = "sans-serif";
let registered = false;

function registerFonts(): void {
  if (registered) return;
  registered = true;
  for (const candidate of FONT_CANDIDATES) {
    if (!existsSync(candidate.regular)) continue;
    try {
      GlobalFonts.registerFromPath(candidate.regular, "Siela");
      regularFamily = "Siela";
      if (existsSync(candidate.bold)) {
        GlobalFonts.registerFromPath(candidate.bold, "SielaBold");
        boldFamily = "SielaBold";
      } else {
        boldFamily = "Siela";
      }
      return;
    } catch {
      // try the next family
    }
  }
}

export function canvasFonts(): { regular: string; bold: string } {
  registerFonts();
  return { regular: regularFamily, bold: boldFamily };
}

export function canvasFont(): string {
  return canvasFonts().regular;
}
