import { useCallback, useEffect, useState } from 'react';
import { useNativeFunction } from './useFunction';
import { useToast } from '../components/Toast';

/** Native poll reply. The measured result rides along when state is 'done':
    `matchedDb` for auto balance, `matchedMs` for auto offset. */
export interface AutoMeasureResult {
  state: string;
  matchedDb?: number;
  matchedMs?: number;
}

/**
 * Drives a one-shot native "listening" measurement (auto balance, auto
 * offset): toggle() arms or cancels, and while armed we poll until the
 * native state machine leaves 'listening' (done, timeout or cancel). The
 * toast follows the flow: "Listening" pinned while armed, then the
 * formatted result on success; cancel and timeout just take it down.
 * `doneMessage` must be referentially stable (a module-level function).
 */
export function useAutoMeasure(
  startFn: string,
  cancelFn: string,
  pollFn: string,
  doneMessage: (result: AutoMeasureResult) => string
) {
  const start = useNativeFunction<boolean>(startFn);
  const cancel = useNativeFunction<boolean>(cancelFn);
  const poll = useNativeFunction<AutoMeasureResult>(pollFn);
  const toast = useToast();
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    const id = setInterval(async () => {
      const res = await poll();
      if (!res || res.state === 'listening') return;
      setListening(false);
      if (res.state === 'done') toast.show(doneMessage(res));
      else toast.clear();
    }, 200);
    return () => clearInterval(id);
  }, [listening, poll, toast, doneMessage]);

  const toggle = useCallback(async () => {
    if (listening) {
      await cancel();
      setListening(false);
      toast.clear();
    } else {
      await start();
      setListening(true);
      toast.pin('Listening');
    }
  }, [listening, start, cancel, toast]);

  return { listening, toggle };
}
