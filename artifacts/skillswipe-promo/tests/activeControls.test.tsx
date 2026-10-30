import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { useSceneControls } from '../src/components/video/useSceneControls';

const sceneLife = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));

// Replace only the expensive scene renderer. App, VideoWithControls,
// useSceneControls, the buttons, and PlaybackStatus are the production code.
vi.mock('../src/components/video/VideoTemplate', () => {
  const SCENE_DURATIONS = {
    hook: 2800, generate: 4200, reveal: 3600,
    swipe: 3800, backgrounds: 3300, outro: 2300,
  };
  return {
    SCENE_DURATIONS,
    default: function SceneSubstitute({
      durations = SCENE_DURATIONS, paused = false, muted = false,
      onSceneChange,
    }: {
      durations?: Record<string, number>; paused?: boolean; muted?: boolean;
      onSceneChange?: (key: string) => void;
    }) {
      useEffect(() => {
        sceneLife.mount();
        return sceneLife.unmount;
      }, []);
      return <div>
        <output data-testid="scene-props">{JSON.stringify({ durations, paused, muted })}</output>
        <button onClick={() => onSceneChange?.('reveal_r2')}>Report scene change</button>
      </div>;
    },
  };
});

let frame: HTMLIFrameElement | undefined;
const originalAnimations = Object.getOwnPropertyDescriptor(document, 'getAnimations');

beforeEach(() => {
  vi.useFakeTimers();
  sceneLife.mount.mockClear();
  sceneLife.unmount.mockClear();
  Object.defineProperty(document, 'getAnimations', {
    configurable: true, writable: true, value: vi.fn(() => []),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  frame?.remove();
  frame = undefined;
  if (originalAnimations) {
    Object.defineProperty(document, 'getAnimations', originalAnimations);
  } else {
    Reflect.deleteProperty(document, 'getAnimations');
  }
  vi.useRealTimers();
});

function preview() {
  frame = document.createElement('iframe');
  document.body.append(frame);
  // New jsdom windows need an explicit connection to Vitest's clock.
  // PlaybackStatus uses window timers, while advanceTimersByTime drives
  // the test global's timers.
  Object.assign(frame.contentWindow!, {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  });
  vi.stubGlobal('window', frame.contentWindow!);
  return render(<App />);
}

function props(view: ReturnType<typeof render>) {
  return JSON.parse(view.getByTestId('scene-props').textContent!);
}

it('wires the mounted app buttons to pause, mute, scene jumps, and active-scene lock replays', () => {
  const view = preview();
  const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  expect(sceneLife.mount).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByRole('button', { name: 'Pause' }));
  expect(props(view).paused).toBe(true);
  fireEvent.click(view.getByRole('button', { name: 'Mute' }));
  expect(props(view).muted).toBe(true);
  fireEvent.click(view.getByRole('button', { name: 'Unmute' }));
  expect(props(view).muted).toBe(false);
  expect(sceneLife.mount).toHaveBeenCalledTimes(1);

  fireEvent.click(view.getByRole('button', { name: 'Jump to scene 3' }));
  expect(props(view).paused).toBe(false);
  expect(Object.keys(props(view).durations)).toEqual([
    'reveal', 'swipe', 'backgrounds', 'outro', 'hook', 'generate',
  ]);
  expect(view.getByRole('button', { name: 'Jump to scene 3' }).getAttribute('aria-current')).toBe('true');
  expect(post).toHaveBeenCalledWith(expect.objectContaining({
    type: 'REPLIT_VIDEO_SCENE_SELECTED',
    payload: expect.objectContaining({ sceneIndex: 2, sceneTitle: 'Tap to reveal' }),
  }), '*');
  expect(sceneLife.mount).toHaveBeenCalledTimes(2);
  fireEvent.click(view.getByRole('button', { name: 'Jump to scene 3' }));
  expect(sceneLife.mount).toHaveBeenCalledTimes(3);

  fireEvent.click(view.getByRole('button', { name: 'Pause' }));
  const lock = view.getByRole('button', { name: 'Loop current scene' });
  fireEvent.click(lock);
  expect(lock.getAttribute('aria-pressed')).toBe('true');
  expect(props(view)).toMatchObject({
    paused: false, durations: { reveal_r1: 3600, reveal_r2: 3600 },
  });
  expect(sceneLife.mount).toHaveBeenCalledTimes(4);
  fireEvent.click(lock);
  expect(lock.getAttribute('aria-pressed')).toBe('false');
  expect(Object.keys(props(view).durations)[0]).toBe('reveal');
  expect(sceneLife.mount).toHaveBeenCalledTimes(5);
  view.unmount();
  expect(sceneLife.unmount).toHaveBeenCalledTimes(5);
  expect(vi.getTimerCount()).toBe(0);
});

it('the active Pause/Play buttons freeze only running animations and release them on unmount', () => {
  const running = { playState: 'running', pause: vi.fn(), play: vi.fn() };
  const paused = { playState: 'paused', pause: vi.fn(), play: vi.fn() };
  const finished = { playState: 'finished', pause: vi.fn(), play: vi.fn() };
  const idle = { playState: 'idle', pause: vi.fn(), play: vi.fn() };
  const animations = vi.spyOn(document, 'getAnimations')
    .mockReturnValue([running, paused, finished, idle] as unknown as Animation[]);
  const view = preview();
  fireEvent.click(view.getByRole('button', { name: 'Pause' }));
  expect(running.pause).toHaveBeenCalledTimes(1);
  for (const other of [paused, finished, idle]) expect(other.pause).not.toHaveBeenCalled();
  // Resuming must use the captured set, not a fresh document-wide scan.
  animations.mockReturnValue([paused, finished, idle] as unknown as Animation[]);
  fireEvent.click(view.getByRole('button', { name: 'Play' }));
  expect(running.play).toHaveBeenCalledTimes(1);
  for (const other of [paused, finished, idle]) expect(other.play).not.toHaveBeenCalled();
  expect(animations).toHaveBeenCalledTimes(1);
  animations.mockReturnValue([running] as unknown as Animation[]);
  fireEvent.click(view.getByRole('button', { name: 'Pause' }));
  view.unmount();
  expect(running.pause).toHaveBeenCalledTimes(2);
  expect(running.play).toHaveBeenCalledTimes(2);
});

it('the active playback timer stops while paused and cleans up its interval', () => {
  const view = preview();
  expect(window.setInterval).toBe(globalThis.setInterval);
  expect(window.clearInterval).toBe(globalThis.clearInterval);
  expect(vi.getTimerCount()).toBe(1);
  act(() => vi.advanceTimersByTime(1200));
  expect(view.getByRole('timer').textContent).toBe('0:01 / 0:20');
  fireEvent.click(view.getByRole('button', { name: 'Pause' }));
  const time = view.getByRole('timer').textContent;
  act(() => vi.advanceTimersByTime(5000));
  expect(view.getByRole('timer').textContent).toBe(time);
  fireEvent.click(view.getByRole('button', { name: 'Play' }));
  act(() => vi.advanceTimersByTime(1000));
  expect(view.getByRole('timer').textContent).toBe('0:02 / 0:20');
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('removes the active touch-control outside-tap listener when unmounted', () => {
  const view = preview();
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');
  fireEvent.click(view.getByRole('button', { name: 'Hide controls' }));
  const show = view.getByLabelText('Show controls');
  const sensor = show.parentElement!.parentElement!;
  const touch = new Event('pointerdown', { bubbles: true });
  Object.defineProperty(touch, 'pointerType', { value: 'touch' });
  fireEvent(sensor, touch);
  const listeners = add.mock.calls.filter(([type]) => type === 'pointerdown');
  expect(listeners).toHaveLength(1);
  view.unmount();
  expect(remove).toHaveBeenCalledWith('pointerdown', listeners[0][1]);
  expect(vi.getTimerCount()).toBe(0);
});

it('top-level App exports without the preview control bar', () => {
  const view = render(<App />);
  expect(view.queryByRole('button', { name: 'Pause' })).toBeNull();
  expect(props(view)).toMatchObject({ paused: false, muted: false });
  expect(vi.getTimerCount()).toBe(0);
});

it('the real scene-control hook tracks reported scenes and restarts only on explicit jumps or locks', () => {
  const durations = { hook: 2800, generate: 4200, reveal: 3600 };
  const { result, rerender } = renderHook(() => useSceneControls(durations));
  act(() => result.current.onSceneChange('reveal_r2'));
  expect(result.current).toMatchObject({
    activeIndex: 2, activeDuration: 3600, activeStartTime: 7000,
    totalDuration: 10600, mountKey: 0,
  });
  act(() => result.current.togglePause());
  expect(result.current.paused).toBe(true);
  expect(result.current.mountKey).toBe(0);
  act(() => result.current.toggleLock());
  expect(result.current).toMatchObject({
    locked: true, paused: false, mountKey: 1,
    durations: { reveal_r1: 3600, reveal_r2: 3600 },
  });
  rerender();
  expect(result.current.mountKey).toBe(1);
  act(() => result.current.toggleLock());
  expect(result.current).toMatchObject({ locked: false, mountKey: 2 });
  act(() => result.current.jumpTo(0));
  expect(result.current).toMatchObject({ activeIndex: 0, mountKey: 3, durations });
  act(() => result.current.jumpTo(2));
  expect(Object.keys(result.current.durations)).toEqual(['reveal', 'hook', 'generate']);
  expect(result.current.mountKey).toBe(4);
});
