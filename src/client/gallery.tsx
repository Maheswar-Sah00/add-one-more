import './index.css';

import type PhaserNS from 'phaser';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OBJECT_LIBRARY } from '../shared/objects';
import { GalleryController } from './phaser/gallery';
import { createGalleryGame } from './phaser/galleryBoot';

export const Gallery = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<PhaserNS.Game | null>(null);
  const controllerRef = useRef<GalleryController | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const controller = new GalleryController();
    controllerRef.current = controller;
    controller.onValidation = (e) => setErrors(e);

    const game = createGalleryGame(container, controller);
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
      controllerRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#181a20] text-slate-100 select-none">
      <div ref={containerRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <div className="pointer-events-auto rounded-lg bg-black/50 px-3 py-1.5 text-[12px] backdrop-blur-sm">
          <span className="font-semibold text-amber-200">🗂 Object Gallery</span>
          <span className="ml-2 text-slate-400">{OBJECT_LIBRARY.length} objects · tap to drop</span>
        </div>
        <button
          onClick={() => controllerRef.current?.reset()}
          className="pointer-events-auto rounded-lg bg-slate-700/80 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-slate-600"
        >
          Reset
        </button>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 text-center">
        {errors.length === 0 ? (
          <span className="rounded bg-emerald-900/60 px-3 py-1 text-[12px] text-emerald-200">
            catalogue valid ✓
          </span>
        ) : (
          <span className="rounded bg-rose-900/70 px-3 py-1 text-[12px] text-rose-200">
            {errors.length} catalogue error(s): {errors.slice(0, 3).join('; ')}
          </span>
        )}
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>
);
