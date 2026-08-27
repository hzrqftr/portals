import preset from "@portals/core/tailwind-preset";

/** @type {import('tailwindcss').Config} */
export default {
  // The core glob is load-bearing: shared components live outside this app's
  // folder, and without it their classes are purged from the stylesheet and
  // the shared chrome renders unstyled.
  content: [
    "./index.html",
    "./src/client/**/*.{ts,tsx}",
    "../../packages/core/src/client/**/*.{ts,tsx}",
  ],
  presets: [preset],
  theme: {
    extend: {
      fontFamily: {
        // Display face for the header wordmark only -- see the subset note in
        // index.css before reaching for it anywhere else.
        wordmark: ['"Bukhari Script"', "ui-serif", "cursive"],
      },
    },
  },
  plugins: [],
};
