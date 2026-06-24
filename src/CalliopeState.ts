export type LEDColor = [number, number, number];

export interface PinState {
  touched: boolean;
  digitalValue: number;
  analogValue: number;
}

export interface CalliopeState {
  ledMatrix: number[][]; // 5x5 grid, 0-255 brightness, but let's say 0-9 like microbit or just boolean to keep it simple. Let's use boolean for now.
  rgbLed: LEDColor; // [r, g, b]
  variables: Record<string, any>;
  pins: {
    P0: PinState;
    P1: PinState;
    P2: PinState;
    P3: PinState;
  };
}

const defaultPinState: PinState = { touched: false, digitalValue: 0, analogValue: 0 };

export const initialCalliopeState: CalliopeState = {
  ledMatrix: Array(5).fill(Array(5).fill(0)), // 0 means off, 1 means on
  rgbLed: [0, 0, 0],
  variables: {},
  pins: {
    P0: { ...defaultPinState },
    P1: { ...defaultPinState },
    P2: { ...defaultPinState },
    P3: { ...defaultPinState },
  }
};
