// React Native Web's dimension and appearance hooks expect these browser APIs.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }),
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// React DOM chooses its animation event name at import time. Without this
// constructor jsdom makes it select a vendor event instead of animationend.
Object.defineProperty(window, 'AnimationEvent', { value: Event, configurable: true });
