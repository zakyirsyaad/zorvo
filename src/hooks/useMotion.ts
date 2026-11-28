import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { MOTION_RENDER_EVENT, parseJobView, parseMotionRead, isOpenJob, type JobView, type MotionRead } from '../lib/motion';

const ARTIFACTS_CHANGED = 'artifacts-changed';

/**
 * One motion as the backend reads it (its formats, whether each is rendered and up to date, its
 * render jobs), read again when the session's artifacts change, when a turn ends, and as its
 * renders move on.
 */
export function useMotion(sessionId: string, key: string, turnsEnded?: number): {
  read: MotionRead | null;
  error: boolean;
  jobs: JobView[];
  refresh: () => void;
} {
  const [read, setRead] = useState<MotionRead | null>(null);
  const [error, setError] = useState(false);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const asked = useRef(0);

  const refresh = useCallback(() => {
    const request = ++asked.current;
    invoke('motion_read', { sessionId, key })
      .then((answer) => {
        if (request !== asked.current) return;
        const parsed = parseMotionRead(answer);
        setRead(parsed);
        setError(parsed === null);
        if (parsed) setJobs(parsed.jobs);
      })
      .catch(() => {
        if (request === asked.current) setError(true);
      });
  }, [sessionId, key]);

  useEffect(() => {
    refresh();
  }, [refresh, turnsEnded]);

  useEffect(() => {
    let isGone = false;
    const changed = listen<unknown>(ARTIFACTS_CHANGED, (event) => {
      if ((event.payload as { sessionId?: unknown } | null)?.sessionId === sessionId && !isGone) refresh();
    });
    const rendered = listen<unknown>(MOTION_RENDER_EVENT, (event) => {
      const job = parseJobView(event.payload);
      if (isGone || job === null || job.sessionId !== sessionId || job.key !== key) return;
      setJobs((previous) => {
        const others = previous.filter((listed) => listed.job !== job.job);
        // A job that ended stays, so the line can say how it ended, until the next one starts.
        return [...others.filter(isOpenJob), job];
      });
      if (!isOpenJob(job)) refresh();
    });
    return () => {
      isGone = true;
      void changed.then((stop) => stop());
      void rendered.then((stop) => stop());
    };
  }, [sessionId, key, refresh]);

  return { read, error, jobs, refresh };
}

/**
 * The preview's clock as the viewer sees it. The wrapper in the page's view keeps the real clock;
 * this mirrors it from the commands sent, for the time and the scrubber.
 */
export function usePlayhead(duration: number): {
  time: number;
  isPlaying: boolean;
  play: () => void;
  pause: () => number;
  seek: (t: number) => void;
} {
  const [time, setTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const started = useRef({ at: 0, from: 0 });

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    const tick = () => {
      const t = Math.min(started.current.from + (performance.now() - started.current.at) / 1000, duration);
      setTime(t);
      if (t >= duration) {
        setIsPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, duration]);

  const play = useCallback(() => {
    setTime((current) => {
      const from = current >= duration ? 0 : current;
      started.current = { at: performance.now(), from };
      return from;
    });
    setIsPlaying(true);
  }, [duration]);

  const pause = useCallback(() => {
    const t = Math.min(started.current.from + (performance.now() - started.current.at) / 1000, duration);
    setIsPlaying(false);
    setTime(t);
    return t;
  }, [duration]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.min(Math.max(t, 0), duration);
      started.current = { at: performance.now(), from: clamped };
      setTime(clamped);
    },
    [duration],
  );

  return { time, isPlaying, play, pause, seek };
}
