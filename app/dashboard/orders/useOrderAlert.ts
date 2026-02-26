import { useRef, useCallback, useEffect } from 'react';

/**
 * Web Audio API hook for loud order alert sound.
 * Auto-resumes AudioContext on first user interaction.
 */
export function useOrderAlert() {
  const ctxRef = useRef<AudioContext | null>(null);
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingRef = useRef(false); // true if we want to ring but ctx is suspended

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return ctxRef.current;
  }, []);

  /** Play a single alert burst (3 two-tone beeps) */
  const playOnce = useCallback(() => {
    try {
      const ctx = getCtx();
      if (ctx.state === 'suspended') {
        pendingRef.current = true;
        ctx.resume();
        return;
      }
      pendingRef.current = false;

      for (let i = 0; i < 3; i++) {
        const offset = i * 0.6;

        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.connect(gain1).connect(ctx.destination);
        osc1.frequency.value = 523; // C5
        osc1.type = 'square';
        gain1.gain.setValueAtTime(0.4, ctx.currentTime + offset);
        gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + offset + 0.2);
        osc1.start(ctx.currentTime + offset);
        osc1.stop(ctx.currentTime + offset + 0.2);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2).connect(ctx.destination);
        osc2.frequency.value = 784; // G5
        osc2.type = 'square';
        gain2.gain.setValueAtTime(0.4, ctx.currentTime + offset + 0.25);
        gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + offset + 0.5);
        osc2.start(ctx.currentTime + offset + 0.25);
        osc2.stop(ctx.currentTime + offset + 0.5);
      }
    } catch {
      // Audio not available
    }
  }, [getCtx]);

  /** Start continuous ringing every 4 seconds until stopAlert() is called */
  const startAlert = useCallback(() => {
    if (loopRef.current) clearInterval(loopRef.current);
    playOnce();
    loopRef.current = setInterval(playOnce, 4000);
  }, [playOnce]);

  /** Stop the continuous ringing */
  const stopAlert = useCallback(() => {
    if (loopRef.current) {
      clearInterval(loopRef.current);
      loopRef.current = null;
    }
    pendingRef.current = false;
  }, []);

  // Listen for user gesture to unlock AudioContext and start pending alert
  useEffect(() => {
    const unlock = () => {
      const ctx = ctxRef.current;
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().then(() => {
          if (pendingRef.current && loopRef.current) {
            playOnce();
          }
        });
      }
    };
    document.addEventListener('click', unlock, { once: false });
    document.addEventListener('keydown', unlock, { once: false });
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, [playOnce]);

  return { playAlert: playOnce, startAlert, stopAlert };
}
