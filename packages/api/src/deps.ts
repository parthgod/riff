import type { Catalog } from '@riff/catalog';
import type { Db } from '@riff/db';
import type { Auth } from './auth';

export interface AppDeps {
  db: Db;
  catalog: Catalog;
  auth: Auth;
  /** Receives failures the API absorbs or hides (500s, failed home sections). Default: console. */
  onError?: (error: unknown, context: string) => void;
}

export function reportError(deps: Pick<AppDeps, 'onError'>, error: unknown, context: string): void {
  if (deps.onError) deps.onError(error, context);
  else console.error(`[api] ${context}`, error);
}
