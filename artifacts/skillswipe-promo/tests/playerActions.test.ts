import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCENE_DETAILS } from '../src/components/video/sceneMeta';
import {
  announceSceneSelection,
  jumpToScene,
  setAudioMuted,
  setPaused,
  setSceneLock,
} from '../src/lib/video/playerActions';
import { playerBridge } from '../src/lib/video/playerBridge';

const sceneKeys = ['test-intro', 'test-middle', 'test-end'];

beforeEach(() => {
  playerBridge.reset();
  playerBridge.registerPlayback({ sceneKeys, durationsMs: [1000, 2000, 3000] });
});

afterEach(() => {
  delete SCENE_DETAILS['test-middle'];
  playerBridge.reset();
});

describe('scene jumps', () => {
  it.each([-1, 3, 99, 0.5, NaN, Infinity, -Infinity])(
    'rejects invalid index %s without state changes or announcements',
    (index) => {
      playerBridge.setPaused(true);
      playerBridge.setStartIndex(1);
      const state = playerBridge.getState();
      const listener = vi.fn();
      const unsubscribe = playerBridge.subscribe(listener);
      const postMessage = vi.spyOn(window.parent, 'postMessage');
      try {
        jumpToScene(index);
        expect(playerBridge.getState()).toBe(state);
        expect(listener).not.toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
      }
    },
  );

  it.each(['unregistered', 'empty'])('ignores a jump with %s playback', (kind) => {
    playerBridge.reset();
    if (kind === 'empty') {
      playerBridge.registerPlayback({ sceneKeys: [], durationsMs: [] });
    }
    const state = playerBridge.getState();
    jumpToScene(0);
    expect(playerBridge.getState()).toBe(state);
  });

  it.each([0, 1, 2])('jumps to valid index %s and restarts once', (index) => {
    playerBridge.setPaused(true);
    playerBridge.setLocked(true);
    playerBridge.publishSceneIndex(2);
    jumpToScene(index);
    expect(playerBridge.getState()).toMatchObject({
      startIndex: index,
      paused: false,
      locked: true,
      remountEpoch: 1,
      loopEpoch: 0,
    });
    // Selecting the same segment again must replay it too.
    jumpToScene(index);
    expect(playerBridge.getState().remountEpoch).toBe(2);
  });

  it('announces a located scene, but permits jumps without source metadata', () => {
    SCENE_DETAILS['test-middle'] = {
      title: 'Middle scene',
      filePath: 'src/components/video/test-middle.tsx',
    };
    const postMessage = vi.spyOn(window.parent, 'postMessage');
    jumpToScene(1);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'REPLIT_VIDEO_SCENE_SELECTED',
      payload: {
        sceneIndex: 1,
        sceneCount: 3,
        sceneTitle: 'Middle scene',
        filePath: 'src/components/video/test-middle.tsx',
        lineNumber: 1,
      },
    }, '*');
    postMessage.mockClear();
    jumpToScene(2);
    expect(playerBridge.getState().startIndex).toBe(2);
    expect(postMessage).not.toHaveBeenCalled();
    announceSceneSelection(99, sceneKeys);
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe('scene lock', () => {
  it.each([true, false])('restarts the active scene on transition to %s', (locked) => {
    playerBridge.setLocked(!locked);
    playerBridge.setStartIndex(0);
    playerBridge.publishSceneIndex(2);
    playerBridge.setPaused(true);
    playerBridge.bumpLoopEpoch();
    setSceneLock(locked);
    expect(playerBridge.getState()).toMatchObject({
      locked,
      startIndex: 2,
      currentIndex: 2,
      paused: false,
      remountEpoch: 1,
      loopEpoch: 1,
    });
  });

  it.each([true, false])('does not replay or unpause an unchanged %s lock', (locked) => {
    playerBridge.setLocked(locked);
    playerBridge.publishSceneIndex(2);
    playerBridge.setPaused(true);
    const state = playerBridge.getState();
    setSceneLock(locked);
    expect(playerBridge.getState()).toBe(state);
  });
});

it('pause and mute update their own state without restarting playback', () => {
  setAudioMuted(true);
  expect(playerBridge.getState().audioMuted).toBeNull();
  playerBridge.registerAudio();
  setAudioMuted(true);
  setPaused(true);
  expect(playerBridge.getState()).toMatchObject({
    audioMuted: true, paused: true, remountEpoch: 0, loopEpoch: 0,
  });
  setAudioMuted(false);
  setPaused(false);
  expect(playerBridge.getState()).toMatchObject({
    audioMuted: false, paused: false, remountEpoch: 0, loopEpoch: 0,
  });
});
