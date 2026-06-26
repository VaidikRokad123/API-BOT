import { perceive } from '../apply/browser-subagent.js';

export async function buildObservation(page, consoleBuffer = null) {
  return perceive(page, consoleBuffer);
}
