import { useEffect, useRef, useState } from "react";

export type PresenceState = "closed" | "opening" | "open" | "closing";

export interface PresenceOptions {
  exitDuration?: number;
  enterDelay?: number;
  reducedMotion?: boolean;
}

export function usePresence(
  open: boolean,
  { exitDuration = 90, enterDelay = 16, reducedMotion = false }: PresenceOptions = {},
) {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<PresenceState>(open ? "open" : "closed");
  const mountedRef = useRef(open);
  const previousOpenRef = useRef(open);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;

    if (open) {
      mountedRef.current = true;
      setMounted(true);
      if (wasOpen) {
        setState("open");
        return;
      }
      if (reducedMotion) {
        setState("open");
        return;
      }
      setState("opening");
      timerRef.current = setTimeout(() => {
        setState("open");
        timerRef.current = null;
      }, enterDelay);
      return;
    }

    if (!mountedRef.current) {
      setState("closed");
      return;
    }

    setState("closing");
    timerRef.current = setTimeout(() => {
      mountedRef.current = false;
      setMounted(false);
      setState("closed");
      timerRef.current = null;
    }, reducedMotion ? 0 : exitDuration);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enterDelay, exitDuration, open, reducedMotion]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { mounted, state } as const;
}
