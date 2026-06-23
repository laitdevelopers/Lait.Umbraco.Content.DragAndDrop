import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts", // side-effecting backofficeEntryPoint
      formats: ["es"],
      // Must match the path the manifest references:
      // /App_Plugins/LaitContentDnd/content-drag-drop.js
      fileName: "content-drag-drop",
    },
    // StaticWebAssetBasePath (App_Plugins/LaitContentDnd) maps this wwwroot to
    // /App_Plugins/LaitContentDnd, so the bundle + the copied public/ manifest
    // land exactly where the manifest references them.
    outDir: "../wwwroot",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // Keep @umbraco-cms/* as bare specifiers so they resolve against
      // Umbraco's runtime import map (never bundled).
      external: [/^@umbraco/],
    },
  },
});
