// Video Template - Replace ReplitLoadingScene with your scenes

import {
  VideoCanvas,
  type VideoAspectRatio,
  useVideoPlayer,
} from '@/lib/video';
import { AnimatePresence } from 'framer-motion';

import { ReplitLoadingScene } from './ReplitLoadingScene';

const SCENE_DURATIONS = {
  loading: 99999999,
};

const VIDEO_ASPECT_RATIO: VideoAspectRatio = '16:9';

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({
    durations: SCENE_DURATIONS,
  });

  return (
    <VideoCanvas
      aspectRatio={VIDEO_ASPECT_RATIO}
      style={{ backgroundColor: 'var(--color-bg-light)' }}
    >
      {/* mode="wait" = sequential, "sync" = simultaneous, "popLayout" = new snaps in while old animates out */}
      <AnimatePresence>
        {/* Replace this with your scenes */}
        {currentScene === 0 && <ReplitLoadingScene key="loading" />}
      </AnimatePresence>
    </VideoCanvas>
  );
}
