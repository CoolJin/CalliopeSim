export type LEDColor = [number, number, number];

export interface CalliopeState {
  ledMatrix: number[][]; // 5x5 grid, 0-255 brightness, but let's say 0-9 like microbit or just boolean to keep it simple. Let's use boolean for now.
  rgbLed: LEDColor; // [r, g, b]
  variables: Record<string, any>;
}

export const initialCalliopeState: CalliopeState = {
  ledMatrix: Array(5).fill(Array(5).fill(0)), // 0 means off, 1 means on
  rgbLed: [0, 0, 0],
  variables: {},
};
