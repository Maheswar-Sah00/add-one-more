/**
 * Bundled object artwork (transparent PNGs), keyed by object id.
 *
 * Drop a `<id>.png` into `src/client/assets/objects/` (e.g. `box.png`) and it is
 * automatically picked up at build time and used as that object's visual — in
 * the physics tower, the choice tray, and the catalog. Any object WITHOUT a PNG
 * transparently falls back to the procedural flat-shaded art, so the game keeps
 * working whether or not the artwork is present.
 *
 * The PNGs must be background-removed + trimmed to the object's silhouette so the
 * image maps cleanly onto the object's physics footprint (see `scripts` / the
 * art pipeline). Vite's `import.meta.glob` returns only files that actually
 * exist, so an empty folder is fine.
 */
const modules = import.meta.glob('./assets/objects/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export const OBJECT_ART: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(modules).map(([path, url]) => [
    path.split('/').pop()!.replace(/\.png$/i, ''),
    url,
  ])
);

export const hasObjectArt = (id: string): boolean => id in OBJECT_ART;
export const objectArtUrl = (id: string): string | undefined => OBJECT_ART[id];
