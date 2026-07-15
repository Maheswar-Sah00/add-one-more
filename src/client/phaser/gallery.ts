/** TASK 4 — object-gallery dev screen controller. */
export type GalleryCommands = {
  reset(): void;
};

export class GalleryController {
  private scene: GalleryCommands | null = null;

  onReady: (() => void) | null = null;
  /** Catalogue validation problems (empty = sound). */
  onValidation: ((errors: string[]) => void) | null = null;

  registerScene(scene: GalleryCommands): void {
    this.scene = scene;
    if (this.onReady) this.onReady();
  }

  emitValidation(errors: string[]): void {
    if (this.onValidation) this.onValidation(errors);
  }

  reset(): void {
    this.scene?.reset();
  }
}
