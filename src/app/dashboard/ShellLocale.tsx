'use client';

import { createContext, useContext } from 'react';
import { getMessages, type Locale } from '@/lib/i18n/messages';

/**
 * UX-2 -- the interface language the server already resolved for this
 * shell, made available to client-only boundaries (route `error.tsx` /
 * `loading.tsx`) that cannot call `getInterfaceLanguage` themselves.
 * Defaults to Spanish, the platform default, outside a shell.
 */
const ShellLocaleContext = createContext<Locale>('es');

export const ShellLocaleProvider = ShellLocaleContext.Provider;

export function useShellMessages() {
  return getMessages(useContext(ShellLocaleContext));
}
