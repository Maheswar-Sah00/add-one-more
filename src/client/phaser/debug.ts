/**
 * Dev-only debug model shared between TowerScene (writer) and UIScene (reader).
 * Passed by reference to both scenes so neither needs to reach across the scene
 * manager or read untyped registry data.
 *
 * TASK 2: set SHOW_DEBUG to false before submission.
 */
export const SHOW_DEBUG = false;

export class DebugModel {
  fps = 0;
  viewW = 0;
  viewH = 0;
  zoom = 1;
  cameraScrollY = 0;
  bodyCount = 0;
  phase = 'idle';
  stability = '';
  assetsOk = true;
}
