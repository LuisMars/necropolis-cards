/**
 * Force-load the bundled fonts before the first card renders.
 *
 * Without this, the first paint of the print preview uses a fallback
 * (serif / sans-serif) until the browser gets around to fetching the
 * font files, then re-flows. The @font-face declarations in styles.css
 * already point at the right URLs — this just kicks the requests off
 * eagerly and returns a Promise we can `await` before rendering.
 */

const FONTS = [
  { family: "JSL Blackletter", url: "fonts/JBLACK.TTF" },
  { family: "Alegreya",        url: "fonts/Alegreya-VF.ttf" },
  { family: "Alegreya",        url: "fonts/Alegreya-Italic-VF.ttf", desc: { style: "italic" } },
  { family: "Alegreya SC",     url: "fonts/AlegreyaSC-Regular.ttf" },
  { family: "Alegreya SC",     url: "fonts/AlegreyaSC-Bold.ttf",      desc: { weight: "bold" } },
  { family: "Alegreya SC",     url: "fonts/AlegreyaSC-Italic.ttf",    desc: { style: "italic" } },
  { family: "Alegreya SC",     url: "fonts/AlegreyaSC-BoldItalic.ttf",desc: { style: "italic", weight: "bold" } },
];

export async function loadFonts() {
  if (!("fonts" in document)) return;     // ancient browser — fall through
  await Promise.all(FONTS.map(async ({ family, url, desc }) => {
    try {
      const ff = new FontFace(family, `url(${url})`, desc || {});
      const loaded = await ff.load();
      document.fonts.add(loaded);
    } catch (e) {
      console.warn(`Font failed to load: ${family} (${url})`, e);
    }
  }));
}
