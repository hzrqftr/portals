import preset from "@portals/core/tailwind-preset";

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/client/**/*.{ts,tsx}",
    "../../packages/core/src/client/**/*.{ts,tsx}",
  ],
  presets: [preset],
  plugins: [],
};
