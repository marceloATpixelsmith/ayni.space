import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

//RESOLVE PORT SAFELY
//USE DEFAULT FOR ENVIRONMENTS LIKE VERCEL WHERE PORT MAY NOT BE PROVIDED AT BUILD TIME
const rawPort = process.env.PORT;
const parsedPort = rawPort ? Number(rawPort) : 3000;
const port =
(
  Number.isFinite(parsedPort) && parsedPort > 0
    ? parsedPort
    : 3000
);

//RESOLVE BASE PATH SAFELY
//DEFAULT TO ROOT SO PRODUCTION BUILDS DO NOT FAIL WHEN BASE_PATH IS NOT PROVIDED
const rawBasePath = process.env.BASE_PATH;
const basePath =
(
  rawBasePath && rawBasePath.trim() !== ""
    ? rawBasePath
    : "/"
);

//ONLY LOAD REPLIT-ONLY PLUGINS WHEN RUNNING IN THAT ENVIRONMENT
const useReplitPlugins =
(
  process.env.NODE_ENV !== "production" &&
  process.env.REPL_ID !== undefined
);

const plugins = [
  react(),
  tailwindcss(),
  runtimeErrorOverlay(),
];

if (useReplitPlugins)
{
  const cartographerModule = await import("@replit/vite-plugin-cartographer");
  const devBannerModule = await import("@replit/vite-plugin-dev-banner");

  plugins.push
  (
    cartographerModule.cartographer
    ({
      root: path.resolve(import.meta.dirname, ".."),
    })
  );

  plugins.push(devBannerModule.devBanner());
}

export default defineConfig
({
  base: basePath,

  plugins,

  resolve:
  {
    alias:
    {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },

  root: path.resolve(import.meta.dirname),

  build:
  {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },

  server:
  {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs:
    {
      strict: true,
      deny: ["**/.*"],
    },
  },

  preview:
  {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
