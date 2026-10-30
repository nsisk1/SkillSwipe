import { useEffect, useRef } from 'react';
import { VideoCanvas, type VideoAspectRatio, useVideoPlayer, VideoPausedContext } from '@/lib/video';
import { AnimatePresence } from 'framer-motion';
import { HookScene, GenerateScene, RevealScene, SwipeScene, BackgroundScene, OutroScene } from './scenes';

export const SCENE_DURATIONS = {
  hook: 2800,
  generate: 4200,
  reveal: 3600,
  swipe: 3800,
  backgrounds: 3300,
  outro: 2300,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  hook: HookScene, generate: GenerateScene, reveal: RevealScene,
  swipe: SwipeScene, backgrounds: BackgroundScene, outro: OutroScene,
};

const SCENE_START_SEC: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  let ms = 0;
  for (const [k, d] of Object.entries(SCENE_DURATIONS)) { out[k] = ms / 1000; ms += d; }
  return out;
})();

const VIDEO_ASPECT_RATIO: VideoAspectRatio = '16:9';

export default function VideoTemplate({
  durations = SCENE_DURATIONS, loop = true, paused = false, muted = false, onSceneChange,
}: {
  durations?: Record<string, number>; loop?: boolean; paused?: boolean; muted?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop, paused });
  useEffect(() => { onSceneChange?.(currentSceneKey); }, [currentSceneKey, onSceneChange]);
  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.45;
    if (paused) { audio.pause(); return; }
    if (lastKey.current !== currentSceneKey) {
      lastKey.current = currentSceneKey;
      const t = SCENE_START_SEC[baseSceneKey] ?? 0;
      if (Math.abs(audio.currentTime - t) > 0.18) audio.currentTime = t;
    }
    audio.play().catch(() => {});
  }, [currentSceneKey, baseSceneKey, muted, paused]);

  return (
    <VideoPausedContext.Provider value={paused}>
      <VideoCanvas aspectRatio={VIDEO_ASPECT_RATIO} style={{ backgroundColor: '#f5f2e9', fontFamily: 'var(--font-body)' }}>
        <AnimatePresence mode="popLayout">
          {SceneComponent && <SceneComponent key={currentSceneKey} />}
        </AnimatePresence>
        <audio ref={audioRef} src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`} preload="auto" autoPlay muted={muted} />
      </VideoCanvas>
    </VideoPausedContext.Provider>
  );
}
