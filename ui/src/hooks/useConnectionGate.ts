import { useCallback, useEffect, useRef, useState } from 'react';
import { T3K_API } from '../t3k/config';

/**
 * Instant connectivity check via `navigator.onLine`. `false` means the OS has
 * no network interface up (the "internet not set up" case we're guarding
 * against); `true` doesn't guarantee the wider internet is reachable, which
 * is what the recovery paths are for (failed-navigation recovery, block retry).
 * Gating stays probe-free so the + button is instant.
 */
function checkInternet(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * One HTTPS reachability probe against the TONE3000 origin. OAuth navigates
 * this same webview to tone3000.com, and when TLS is broken (wrong system
 * clock, intercepting proxy or security software) that navigation strands the
 * webview on a dead page. So we probe once at startup and gate on the cached
 * result instead of probing at click time. `no-cors` because only the TLS
 * handshake matters, not the response.
 */
async function probeSecureConnection(): Promise<boolean> {
  try {
    await fetch(T3K_API, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    return true;
  } catch {
    return false;
  }
}

export type ConnectionProblem = 'offline' | 'insecure';

/**
 * First line of defence for network-dependent actions (add / swap / login /
 * select):
 *
 *   const gate = useConnectionGate();
 *   const onAdd = () => gate.requireConnection(() => startSelectFlow());
 *   ...
 *   <ConnectionModal problem={gate.problem}
 *                    onRetry={gate.retry} onDismiss={gate.dismiss} />
 *
 * `requireConnection` runs the action when the OS reports a connection and
 * the startup TLS probe didn't fail; otherwise it opens the matching modal
 * variant. "Try again" re-checks (re-probing TLS if that's what failed) and
 * runs the original action on success.
 *
 * A failed probe while offline stays silent: offline use is normal and
 * already handled at action time. The modal only appears when the internet
 * is up but a secure connection is refused.
 */
export function useConnectionGate() {
  const [problem, setProblem] = useState<ConnectionProblem | null>(null);
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null);
  // Known-bad TLS from the last probe; only ever set while online.
  const insecureRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void probeSecureConnection().then((ok) => {
      if (cancelled || ok || !checkInternet()) return;
      insecureRef.current = true;
      setProblem('insecure');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const requireConnection = useCallback((action: () => void | Promise<void>) => {
    if (!checkInternet()) {
      pendingActionRef.current = action;
      setProblem('offline');
    } else if (insecureRef.current) {
      pendingActionRef.current = action;
      setProblem('insecure');
    } else {
      pendingActionRef.current = null;
      setProblem(null);
      void action();
    }
  }, []);

  const retry = useCallback(async () => {
    if (insecureRef.current && checkInternet())
      insecureRef.current = !(await probeSecureConnection());
    const action = pendingActionRef.current;
    if (action) requireConnection(action);
    else if (checkInternet() && !insecureRef.current) setProblem(null);
  }, [requireConnection]);

  const dismiss = useCallback(() => {
    pendingActionRef.current = null;
    setProblem(null);
  }, []);

  return { requireConnection, problem, retry, dismiss };
}
