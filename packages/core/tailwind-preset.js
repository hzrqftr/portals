/**
 * Shared design tokens. Consumed by each app via `presets: [corePreset]`.
 *
 * The palette is DARK ONLY -- it is the base colour set, not a `dark:`
 * overlay. There are no `dark:` variants in any portal, and adding one means
 * the palette below is the thing that is wrong. Do not reintroduce raw
 * Tailwind colours like `stone-600` or `bg-white`: they look correct in
 * isolation and wrong on the page.
 *
 * Apps add their own `content` globs and `fontFamily.wordmark` on top.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: [],
  theme: {
    extend: {
      colors: {
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
         * Status colours. Always paired with a word, never the only signal.
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
