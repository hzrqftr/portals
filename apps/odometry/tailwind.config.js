/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/client/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Display face for the header wordmark only -- see the subset note in
        // index.css before reaching for it anywhere else.
        wordmark: ['"Bukhari Script"', 'ui-serif', 'cursive'],
      },
      colors: {
        /**
         * The app is DARK ONLY, so this is the base palette rather than a
         * `dark:` overlay. That is the point of committing to one theme: a
         * single pass over the styling instead of two palettes that drift
         * apart every time a component is edited.
         *
         * There are no `dark:` variants anywhere in src/client. If you find
         * yourself adding one, the palette below is the thing to change.
         */
        page: "#0B0B0C", // app background
        surface: "#17171A", // cards, sheets
        inset: "#101012", // inputs, panels nested inside a card
        edge: "#27272B", // borders
        ink: {
          DEFAULT: "#EDEDEF", // primary text
          muted: "#A1A1AA", // secondary text
          faint: "#71717A", // metadata, disabled
        },

        /**
         * Status colours. Spec 9: these are ALWAYS paired with the status
         * word and never used as the only signal -- which matters more in a
         * tile grid than it did in a list, because a tile is mostly colour.
         */
        status: {
          "overdue-bg": "#2A1214",
          "overdue-fg": "#FCA5A5",
          "soon-bg": "#2A1F0E",
          "soon-fg": "#FCD34D",
          "ok-bg": "#0E2419",
          "ok-fg": "#6EE7B7",
          "unknown-bg": "#1F1F23",
          "unknown-fg": "#A1A1AA",
        },
      },
    },
  },
  plugins: [],
};
