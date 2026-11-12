import { useEffect, useState } from "react";

/**
 * Current time that updates every `intervalMs`, aligned to interval
 * boundaries. Keep consumers small so only they re-render on each tick.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = intervalMs - (Date.now() % intervalMs) + 5;
      timer = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [intervalMs]);
  return now;
}
