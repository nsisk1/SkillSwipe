import { useContext, useEffect } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceControlledVideo } from '../src/lib/video/controls';
import { VideoPausedContext } from '../src/lib/video/hooks';
import { playerBridge } from '../src/lib/video/playerBridge';
import { jumpToScene, setPaused, setSceneLock } from '../src/lib/video/playerActions';
import {
  VIDEO_CONTROLS_CLAIM_MESSAGE_TYPE,
  VIDEO_CONTROLS_COMMAND_MESSAGE_TYPE,
  VIDEO_PLAYER_STATE_MESSAGE_TYPE,
} from '../src/lib/video/workspaceControls';

let frame: HTMLIFrameElement | undefined;
const originalGetAnimations = Object.getOwnPropertyDescriptor(document, 'getAnimations');

beforeEach(() => {
  Object.defineProperty(document, 'getAnimations', {
    configurable: true,
    writable: true,
    value: vi.fn(() => []),
  });
  playerBridge.reset();
  playerBridge.registerPlayback({
    sceneKeys: ['intro', 'end'], durationsMs: [1000, 2000],
  });
});

afterEach(() => {
  // Unmount while the iframe window and DOM spies are still available.
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalGetAnimations) {
    Object.defineProperty(document, 'getAnimations', originalGetAnimations);
  } else {
    Reflect.deleteProperty(document, 'getAnimations');
  }
  frame?.remove();
  frame = undefined;
  playerBridge.reset();
});

function iframeWindow() {
  frame = document.createElement('iframe');
  document.body.append(frame);
  const childWindow = frame.contentWindow!;
  // Use a genuine iframe window (self !== top), not a mock of the wrapper.
  vi.stubGlobal('window', childWindow);
  return childWindow;
}

function send(type: string, payload: unknown) {
  window.dispatchEvent(new MessageEvent('message', {
    source: window.parent,
    origin: 'https://replit.com',
    data: { type, payload },
  }));
}

function animation(playState: AnimationPlayState) {
  return { playState, pause: vi.fn(), play: vi.fn() };
}

function mockAnimations(animations: ReturnType<typeof animation>[]) {
  const getAnimations = vi.fn(() => animations as unknown as Animation[]);
  // jsdom has no Web Animations implementation; only this browser boundary
  // is replaced. The component, effects, bridge, and protocol stay real.
  vi.spyOn(document, 'getAnimations').mockImplementation(getAnimations);
  return getAnimations;
}

function PauseProbe() {
  return <span data-testid="paused">{String(useContext(VideoPausedContext))}</span>;
}

it('leaves top-level export playback untouched and installs no listeners', () => {
  expect(window.self).toBe(window.top);
  const addListener = vi.spyOn(window, 'addEventListener');
  const subscribe = vi.spyOn(playerBridge, 'subscribe');
  const view = render(<WorkspaceControlledVideo><PauseProbe /></WorkspaceControlledVideo>);
  act(() => setPaused(true));
  expect(view.getByTestId('paused').textContent).toBe('false');
  expect(subscribe).not.toHaveBeenCalled();
  expect(addListener.mock.calls.filter(([type]) => type === 'message')).toHaveLength(0);
});

it('freezes running animations and resumes only those it paused, once per cycle', () => {
  iframeWindow();
  const running = animation('running');
  const alsoRunning = animation('running');
  const alreadyPaused = animation('paused');
  const finished = animation('finished');
  const idle = animation('idle');
  const getAnimations = mockAnimations([running, alreadyPaused, finished, idle, alsoRunning]);
  const view = render(<WorkspaceControlledVideo><PauseProbe /></WorkspaceControlledVideo>);
  expect(getAnimations).not.toHaveBeenCalled();
  act(() => setPaused(true));
  expect(view.getByTestId('paused').textContent).toBe('true');
  for (const item of [running, alsoRunning]) {
    expect(item.pause).toHaveBeenCalledTimes(1);
    expect(item.play).not.toHaveBeenCalled();
  }
  for (const item of [alreadyPaused, finished, idle]) {
    expect(item.pause).not.toHaveBeenCalled();
    expect(item.play).not.toHaveBeenCalled();
  }
  act(() => setPaused(true));
  act(() => playerBridge.setWorkspaceOwned(true));
  expect(getAnimations).toHaveBeenCalledTimes(1);

  const later = animation('running');
  getAnimations.mockReturnValue([later] as unknown as Animation[]);
  act(() => setPaused(false));
  expect(view.getByTestId('paused').textContent).toBe('false');
  for (const item of [running, alsoRunning]) expect(item.play).toHaveBeenCalledTimes(1);
  for (const item of [alreadyPaused, finished, idle, later]) {
    expect(item.play).not.toHaveBeenCalled();
  }
  act(() => setPaused(true));
  expect(later.pause).toHaveBeenCalledTimes(1);
  act(() => setPaused(false));
  expect(later.play).toHaveBeenCalledTimes(1);
  expect(running.play).toHaveBeenCalledTimes(1);
});

it('releases frozen animations when unmounted while paused', () => {
  iframeWindow();
  const running = animation('running');
  const alreadyPaused = animation('paused');
  mockAnimations([running, alreadyPaused]);
  const view = render(<WorkspaceControlledVideo>Scene</WorkspaceControlledVideo>);
  act(() => setPaused(true));
  view.unmount();
  expect(running.pause).toHaveBeenCalledTimes(1);
  expect(running.play).toHaveBeenCalledTimes(1);
  expect(alreadyPaused.play).not.toHaveBeenCalled();
});

it('supports browsers without document.getAnimations', () => {
  iframeWindow();
  Object.defineProperty(document, 'getAnimations', { value: undefined });
  const view = render(<WorkspaceControlledVideo><PauseProbe /></WorkspaceControlledVideo>);
  act(() => setPaused(true));
  expect(view.getByTestId('paused').textContent).toBe('true');
  act(() => setPaused(false));
  view.unmount();
});

it('remounts scenes for jumps, lock transitions, and loop epochs, not pause or repeated locks', () => {
  iframeWindow();
  const mount = vi.fn();
  const unmount = vi.fn();
  function Scene() {
    useEffect(() => {
      mount();
      return unmount;
    }, []);
    return <PauseProbe />;
  }
  render(<WorkspaceControlledVideo><Scene /></WorkspaceControlledVideo>);
  expect(mount).toHaveBeenCalledTimes(1);
  act(() => setPaused(true));
  expect(mount).toHaveBeenCalledTimes(1);
  act(() => jumpToScene(1));
  expect(mount).toHaveBeenCalledTimes(2);
  act(() => setSceneLock(true));
  expect(mount).toHaveBeenCalledTimes(3);
  act(() => setSceneLock(true));
  expect(mount).toHaveBeenCalledTimes(3);
  act(() => playerBridge.bumpLoopEpoch());
  expect(mount).toHaveBeenCalledTimes(4);
  expect(unmount).toHaveBeenCalledTimes(3);
});

it('removes message listeners and bridge subscriptions on unmount and can mount again cleanly', () => {
  iframeWindow();
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const postMessage = vi.spyOn(window.parent, 'postMessage');
  const view = render(<WorkspaceControlledVideo><PauseProbe /></WorkspaceControlledVideo>);
  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: VIDEO_PLAYER_STATE_MESSAGE_TYPE,
  }), '*');
  act(() => send(VIDEO_CONTROLS_CLAIM_MESSAGE_TYPE, { claimed: true }));
  expect(playerBridge.getState().workspaceOwned).toBe(true);
  act(() => send(VIDEO_CONTROLS_COMMAND_MESSAGE_TYPE, { command: 'setPaused', paused: true }));
  expect(view.getByTestId('paused').textContent).toBe('true');
  const listeners = add.mock.calls.filter(([type]) => type === 'message');
  expect(listeners).toHaveLength(1);
  view.unmount();
  expect(remove).toHaveBeenCalledWith('message', listeners[0][1]);
  expect(playerBridge.getState().workspaceOwned).toBe(false);
  postMessage.mockClear();
  const state = playerBridge.getState();
  send(VIDEO_CONTROLS_COMMAND_MESSAGE_TYPE, { command: 'setPaused', paused: false });
  send(VIDEO_CONTROLS_CLAIM_MESSAGE_TYPE, { claimed: true });
  expect(playerBridge.getState()).toBe(state);
  playerBridge.setPaused(false);
  expect(postMessage).not.toHaveBeenCalled();

  const second = render(<WorkspaceControlledVideo><PauseProbe /></WorkspaceControlledVideo>);
  postMessage.mockClear();
  act(() => send(VIDEO_CONTROLS_COMMAND_MESSAGE_TYPE, { command: 'setPaused', paused: true }));
  expect(second.getByTestId('paused').textContent).toBe('true');
  expect(postMessage).toHaveBeenCalledTimes(1);
  second.unmount();
});
