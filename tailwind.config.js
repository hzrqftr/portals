/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/client/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Status colours are always paired with text, never colour alone (spec §9).
        ok: "#15803d",
        soon: "#b45309",
        overdue: "#b91c1c",
        unknown: "#57534e",
      },
    },
  },
  plugins: [],
};
