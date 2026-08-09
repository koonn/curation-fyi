import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://curation-fyi.pages.dev",
  vite: {
    plugins: [tailwindcss()],
  },
});
