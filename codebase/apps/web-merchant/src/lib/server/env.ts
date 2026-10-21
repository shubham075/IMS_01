import "server-only";
import { z } from "zod";

const schema = z.object({
  /** Base URL of the Idea01 API as seen from this server (not from the browser). */
  API_URL: z.url().default("http://localhost:3001"),
  /** Raster tile server for the map picker. Replace with a commercial provider before launch (OSM tiles are for light use). */
  NEXT_PUBLIC_MAP_TILE_URL: z.string().default("https://tile.openstreetmap.org/{z}/{x}/{y}.png"),
});

export const env = schema.parse(process.env);
