export interface CardRecord {
  label: string;
  active: boolean;
  createdAt: number;
}

export interface Card extends CardRecord {
  uid: string;
}

export type ScanResult = 'granted' | 'unknown' | 'revoked' | 'unavailable';

interface ScanRecord {
  uid: string;
  result: ScanResult;
  scannedAt: number;
  readerId: string;
}

export interface Scan extends ScanRecord {
  id: string;
}

interface Config {
  apiKey: string;
  databaseURL: string;
}

interface Credentials {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
}

interface RefreshResponse {
  id_token: string;
  refresh_token: string;
  expires_in: string;
}

export class ParkingApi {
  private expiresAt = 0;
  private refreshRequest?: Promise<void>;
  private readonly controller = new AbortController();

  private constructor(
    private readonly config: Config,
    readonly email: string,
    private credentials: Credentials,
  ) {
    this.setCredentials(credentials);
  }

  static async loadConfig(): Promise<Config> {
    const response = await fetch(new URL('firebase-config.json', document.baseURI), {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Configuration file unavailable');
    const config: Config = await response.json();
    const url = new URL(config.databaseURL);
    if (!/^AIza[\w-]+$/.test(config.apiKey) || url.protocol !== 'https:' ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.(?:firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname) ||
        url.pathname !== '/' || url.search || url.hash || url.port || url.username || url.password) {
      throw new Error('Invalid Firebase configuration');
    }
    return { apiKey: config.apiKey, databaseURL: url.origin };
  }

  static async signIn(config: Config, email: string, password: string): Promise<ParkingApi> {
    const response = await fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(config.apiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
        signal: AbortSignal.timeout(12000),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      const code = result.error?.message;
      if (['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'USER_DISABLED'].includes(code)) {
        throw new Error('Sign-in failed. Check your email and password.');
      }
      throw new Error('Firebase could not sign you in. Check the project configuration and try again.');
    }
    const api = new ParkingApi(config, email, result);
    if (await api.request<boolean | null>('roles/admins/' + encodeURIComponent(result.localId)) !== true) {
      api.close();
      throw new Error('This account does not have parking administrator access.');
    }
    return api;
  }

  close(): void {
    this.controller.abort();
    this.credentials = { idToken: '', refreshToken: '', expiresIn: '0' };
  }

  async listCards(): Promise<Card[]> {
    const data = await this.request<Record<string, CardRecord> | null>('cards');
    return Object.entries(data ?? {})
      .map(([uid, card]) => ({ ...card, uid }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.uid.localeCompare(b.uid));
  }

  async listScans(): Promise<Scan[]> {
    const data = await this.request<Record<string, ScanRecord> | null>(
      'accessEvents', {}, { orderBy: '"scannedAt"', limitToLast: '100' },
    );
    return Object.entries(data ?? {})
      .map(([id, scan]) => ({ ...scan, id }))
      .sort((a, b) => b.scannedAt - a.scannedAt || b.id.localeCompare(a.id));
  }

  async register(uid: string, label: string): Promise<Card> {
    const card = await this.request<CardRecord>('cards/' + uid, {
      method: 'PUT',
      body: JSON.stringify({ label, active: true, createdAt: { '.sv': 'timestamp' } }),
    });
    return { ...card, uid };
  }

  async setActive(uid: string, active: boolean): Promise<void> {
    await this.request('cards/' + uid + '/active', { method: 'PUT', body: JSON.stringify(active) });
  }

  private setCredentials(credentials: Credentials): void {
    this.credentials = credentials;
    this.expiresAt = Date.now() + Number(credentials.expiresIn) * 1000;
  }

  private async refresh(): Promise<void> {
    const response = await fetch(
      'https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(this.config.apiKey),
      {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.credentials.refreshToken }),
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(12000)]),
      },
    );
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        throw new Error('Your session expired. Sign out and sign in again.');
      }
      throw new Error('Could not refresh the Firebase session. Try again.');
    }
    const result: RefreshResponse = await response.json();
    if (this.controller.signal.aborted) return;
    this.setCredentials({ idToken: result.id_token, refreshToken: result.refresh_token, expiresIn: result.expires_in });
  }

  private async request<T>(path: string, init: RequestInit = {}, query: Record<string, string> = {}): Promise<T> {
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(12000)]);
    signal.throwIfAborted();
    if (Date.now() > this.expiresAt - 60_000) {
      this.refreshRequest ??= this.refresh().finally(() => this.refreshRequest = undefined);
      await this.refreshRequest;
    }

    const url = new URL(path + '.json', this.config.databaseURL + '/');
    url.search = new URLSearchParams({ ...query, auth: this.credentials.idToken }).toString();
    const response = await fetch(url, {
      ...init,
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      cache: 'no-store',
      signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error('Firebase denied this request. Check your permissions and the database rules.');
    }
    if (!response.ok) throw new Error('Firebase could not complete the request. Try again.');
    return response.json();
  }
}

export function normalizeUid(value: string): string {
  return value.replace(/[\s:-]/g, '').toUpperCase();
}

export function isCardUid(uid: string): boolean {
  return /^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(uid);
}
