import { perceive } from './engine.js';

export async function buildObservation(page, consoleBuffer = null) {
  return perceive(page, consoleBuffer);
}
