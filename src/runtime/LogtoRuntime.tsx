import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LogtoProvider,
  useHandleSignInCallback,
  useLogto,
  type IdTokenClaims,
  type LogtoConfig,
} from '@logto/react';
import { useLocation } from '@rspress/core/runtime';
import type { AuthUser, RuntimeAuthState, RuntimeCommentOptions } from './types';

const LOGTO_RETURN_TO_KEY = 'hf-comments-logto-return-to';

export function WithLogto({
  children,
  handleCallback = true,
  options,
}: {
  children: (auth?: RuntimeAuthState) => ReactNode;
  handleCallback?: boolean;
  options: RuntimeCommentOptions;
}) {
  const logto = options.logto;

  if (!logto) {
    return <>{children()}</>;
  }

  const config: LogtoConfig = {
    endpoint: logto.endpoint,
    appId: logto.appId,
  };

  return (
    <LogtoProvider config={config}>
      <LogtoRuntimeContent handleCallback={handleCallback} options={options}>
        {children}
      </LogtoRuntimeContent>
    </LogtoProvider>
  );
}

function LogtoRuntimeContent({
  children,
  handleCallback,
  options,
}: {
  children: (auth: RuntimeAuthState) => ReactNode;
  handleCallback: boolean;
  options: RuntimeCommentOptions;
}) {
  const location = useLocation();
  const pathname = (location as { pathname?: string })?.pathname || '/';
  const callbackPath = options.logto?.callbackPath ?? '/callback';

  if (handleCallback && pathname === callbackPath) {
    return <LogtoCallback />;
  }

  return <LogtoAuthBridge options={options}>{children}</LogtoAuthBridge>;
}

function LogtoCallback() {
  const { isLoading, error } = useHandleSignInCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const returnTo = window.sessionStorage.getItem(LOGTO_RETURN_TO_KEY) || '/';
    window.sessionStorage.removeItem(LOGTO_RETURN_TO_KEY);
    window.history.replaceState(null, '', returnTo);
    window.dispatchEvent(new Event('popstate'));
  });

  if (isLoading) {
    return <div className="hf-comments-meta">Redirecting...</div>;
  }

  if (error) {
    return <div className="hf-comments-error">{error.message}</div>;
  }

  return null;
}

function LogtoAuthBridge({
  children,
  options,
}: {
  children: (auth: RuntimeAuthState) => ReactNode;
  options: RuntimeCommentOptions;
}) {
  const {
    getIdTokenClaims,
    isAuthenticated,
    isLoading,
    signIn,
    signOut,
  } = useLogto();
  const [claims, setClaims] = useState<IdTokenClaims | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!isAuthenticated) {
        setClaims(null);
        return;
      }

      const nextClaims = await getIdTokenClaims();
      if (!cancelled) {
        setClaims(nextClaims ?? null);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [getIdTokenClaims, isAuthenticated]);

  const login = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.sessionStorage.setItem(LOGTO_RETURN_TO_KEY, returnTo);
    void signIn(`${window.location.origin}${options.logto?.callbackPath ?? '/callback'}`);
  }, [options.logto?.callbackPath, signIn]);

  const logout = useCallback(() => {
    const redirectUri =
      options.logto?.postSignOutRedirectUri ??
      (typeof window !== 'undefined' ? `${window.location.origin}/` : undefined);
    void signOut(redirectUri);
  }, [options.logto?.postSignOutRedirectUri, signOut]);

  const auth = useMemo<RuntimeAuthState>(() => {
    const user = claims ? claimsToUser(claims) : null;

    return {
      authEnabled: true,
      authLabel: 'Logto',
      currentUser: user,
      isLoading,
      login,
      logout,
    };
  }, [claims, isLoading, login, logout]);

  return <>{children(auth)}</>;
}

function claimsToUser(claims: IdTokenClaims): AuthUser {
  const login = claims.username ?? claims.email ?? null;

  return {
    id: claims.sub,
    login,
    name: claims.name ?? login ?? claims.sub,
    avatarUrl: claims.picture ?? null,
  };
}
