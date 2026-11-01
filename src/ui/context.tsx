import { createContext, useContext } from 'react';
import type { AuthUser, Flash, OrgContext } from '@/server/http';

export interface UiContextValue {
  path: string;
  csrfToken: string;
  user: AuthUser | null;
  org: OrgContext | null;
  flash: Flash | null;
  unreadCount: number;
  isDev: boolean;
  aiConfigured: boolean;
  aiIsMock: boolean;
  legalReviewed: boolean;
  /** Datakilder som er verifisert mot ekte API ("ted", "doffin"). */
  liveSources: string[];
}

export const UiContext = createContext<UiContextValue>({
  path: '/',
  csrfToken: '',
  user: null,
  org: null,
  flash: null,
  unreadCount: 0,
  isDev: false,
  aiConfigured: false,
  aiIsMock: false,
  legalReviewed: false,
  liveSources: [],
});

export function useUi(): UiContextValue {
  return useContext(UiContext);
}
