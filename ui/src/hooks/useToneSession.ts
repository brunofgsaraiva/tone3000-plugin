import { useCallback, useEffect, useState } from 'react';
import { useNativeFunction } from './useFunction';
import { useT3kSelect } from './useT3kSelect';
import { T3K_ARCHITECTURE } from '../t3k/config';
import type { Model, Tone, User } from '../types/tone';

// Signed-in identity, cached so the header avatar/name paint instantly on
// relaunch instead of waiting for the getUser round trip; overwritten with
// fresh data once that request resolves, cleared on logout.
const USER_CACHE_KEY = 't3k.cachedUser';

/**
 * The signed-up email of whoever last used this machine, for the login
 * flow's `login_hint`, so a returning user is not asked to retype an address
 * TONE3000 already knows.
 *
 * Read straight from the cache rather than from the `user` state: that state
 * is null exactly when a login is being started (no live session), while the
 * cache survives an expired or rejected refresh token. Logout clears it, so a
 * deliberate sign-out still lands on an empty field.
 *
 * Returns undefined whenever there is nothing to offer (no cache, storage
 * unavailable, or a payload without an email), and the login page then opens
 * exactly as it did before.
 */
function readCachedLoginHint(): string | undefined {
  try {
    const cached = localStorage.getItem(USER_CACHE_KEY);
    if (!cached) return undefined;
    const email = (JSON.parse(cached) as User).email;
    return typeof email === 'string' && email.length > 0 ? email : undefined;
  } catch {
    return undefined;
  }
}

interface UseToneSessionOptions {
  /**
   * A fully-resolved tone (with embedded models) landed, from the Select
   * flow's callback or a card pick in the in-plugin browser. Native already
   * holds a fresh access token when this fires.
   */
  onToneSelected: (tone: Tone & { models: Model[] }) => void | Promise<void>;
  /** A login-only flow finished; the caller should open the tone browser. */
  onAuthenticated: () => void;
}

/**
 * The TONE3000 session in one place: the API client and its OAuth flows,
 * the signed-in identity for the header, and keeping native's copy of the
 * access token in sync (native downloads model files itself and attaches
 * the token as a Bearer header).
 */
export function useToneSession({ onToneSelected, onAuthenticated }: UseToneSessionOptions) {
  const setAccessToken = useNativeFunction<boolean>('setAccessToken');
  const clearAuthCookies = useNativeFunction<boolean>('clearAuthCookies');
  // The address typed on the sign-in page, remembered natively (see
  // TONE3000Processor::persistLoginEmail). Empty string clears it.
  const getLoginEmail = useNativeFunction<string>('getLoginEmail');
  const setLoginEmail = useNativeFunction<boolean>('setLoginEmail');

  // Push the latest access token down to native. Called right after the
  // OAuth flows and again whenever T3KClient transparently refreshes.
  const pushAccessTokenToNative = useCallback(
    async (accessToken: string) => {
      await setAccessToken(accessToken);
    },
    [setAccessToken]
  );

  // Guarantee native has a token before it forwards a selection: the picked
  // tone's model download starts immediately on the native side.
  const handleToneSelected = useCallback(
    async (tone: Tone & { models: Model[] }, accessToken: string) => {
      await pushAccessTokenToNative(accessToken);
      await onToneSelected(tone);
    },
    [onToneSelected, pushAccessTokenToNative]
  );

  const {
    client,
    startSelectFlow,
    startLoginFlow,
    selectToneById,
    retryFlow,
    oauthPhase,
    oauthError,
    clearOauthError,
  } = useT3kSelect({
    onToneSelected: handleToneSelected,
    onAccessTokenUpdated: pushAccessTokenToNative,
    onAuthenticated,
  });

  // The token listener pushes every new/refreshed token set as it happens;
  // ensureNativeAuth() is the guarantee on top: it validates the token
  // (refreshing when near expiry) and awaits the push, so a native download
  // can never start against a stale Bearer.
  // Wrap the raw flow so every login carries the hint, and no call site has
  // to remember to ask for it.
  // Native's remembered address wins: it is what the user actually typed on
  // the sign-in page (the iOS user script captures it), while the identity
  // cache only ever has an email when the API happens to return one.
  const startLoginFlowWithHint = useCallback(
    async (options?: { openBrowser?: boolean }) => {
      const remembered = await getLoginEmail();
      const loginHint =
        (typeof remembered === 'string' && remembered.length > 0 ? remembered : undefined) ??
        readCachedLoginHint();
      startLoginFlow({ ...options, loginHint });
    },
    [getLoginEmail, startLoginFlow]
  );

  const ensureNativeAuth = useCallback(async () => {
    await pushAccessTokenToNative(await client.getAccessToken());
  }, [client, pushAccessTokenToNative]);

  // A remembered login (tokens read straight from localStorage on a fresh
  // webview) never fires the token listener, so native would otherwise sit
  // tokenless until the next OAuth return or refresh. Sync once on mount.
  useEffect(() => {
    if (!client.isAuthenticated()) return;
    ensureNativeAuth().catch(() => {
      // Refresh token rejected; the next + / login flow re-authenticates.
    });
  }, [client, ensureNativeAuth]);

  // Signed-in identity for the header's account pill. Seeded from the
  // localStorage cache (only when a session is present) so the avatar and
  // name paint instantly on relaunch, refreshed after each OAuth return.
  const [user, setUser] = useState<User | null>(() => {
    if (!client.isAuthenticated()) return null;
    try {
      const cached = localStorage.getItem(USER_CACHE_KEY);
      return cached ? (JSON.parse(cached) as User) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (oauthPhase !== 'idle' || !client.isAuthenticated()) return;
    let cancelled = false;
    client
      .getUser()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        try {
          localStorage.setItem(USER_CACHE_KEY, JSON.stringify(u));
        } catch {
          // The cache is a nicety; storage failures are non-fatal.
        }
      })
      .catch(() => {
        // The avatar is decorative; auth failures surface via the flows.
      });
    return () => {
      cancelled = true;
    };
  }, [client, oauthPhase]);

  // Logout clears auth everywhere: the API client's persisted tokens plus
  // any mid-flight PKCE state, native's copy of the access token, and the
  // webview's tone3000.com session cookies. Without the last one, the next
  // OAuth redirect would silently re-approve on the still-live site session
  // and it would look like logout never happened.
  const logout = useCallback(async () => {
    client.logout();
    try {
      localStorage.removeItem(USER_CACHE_KEY);
    } catch {
      // Non-fatal; the stale cache is only read when a session is present.
    }
    setUser(null);
    // A deliberate sign-out must not leave the next login pre-filled.
    await Promise.all([pushAccessTokenToNative(''), clearAuthCookies(), setLoginEmail('')]);
  }, [clearAuthCookies, client, pushAccessTokenToNative, setLoginEmail]);

  /**
   * Fetch a tone's full model catalog (tones max out at 300 models, so one
   * call covers it). Backs the detail card's model picker; the persisted
   * block only carries the active model. NAM keeps the v2-architecture
   * filter, which is all the plugin loads.
   */
  const listToneModels = useCallback(
    async (toneId: number, format: string | undefined) => {
      const isNam = format?.toLowerCase() === 'nam';
      const res = await client.listModels(toneId, {
        pageSize: 300,
        ...(isNam && T3K_ARCHITECTURE !== undefined ? { architecture: T3K_ARCHITECTURE } : {}),
      });
      return res.data;
    },
    [client]
  );

  /** Full catalog tone (description / makes / tags / url). Backs the detail
      card's info panel; not persisted, so saved chain state stays slim. */
  const getTone = useCallback((toneId: number) => client.getTone(toneId), [client]);
  const setToneFavorite = useCallback(
    (toneId: number, favorite: boolean) =>
      favorite ? client.favoriteTone(toneId) : client.unfavoriteTone(toneId),
    [client]
  );

  return {
    client,
    user,
    startSelectFlow,
    startLoginFlow: startLoginFlowWithHint,
    selectToneById,
    retryFlow,
    oauthPhase,
    oauthError,
    clearOauthError,
    ensureNativeAuth,
    listToneModels,
    getTone,
    setToneFavorite,
    logout,
  };
}
