import { DatePipe } from '@angular/common';
import { Component, ElementRef, OnDestroy, computed, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Card, ParkingApi, Scan, ScanResult, isCardUid, normalizeUid } from './parking-api';

type Page = 'Overview' | 'Cards' | 'Scan log';

@Component({
  selector: 'parking-app',
  imports: [DatePipe, FormsModule],
  templateUrl: './parking-app.html',
})
export class ParkingApp implements OnDestroy {
  readonly pages: Page[] = ['Overview', 'Cards', 'Scan log'];
  readonly page = signal<Page>('Overview');
  readonly api = signal<ParkingApi | null>(null);
  readonly ready = signal(false);
  readonly cards = signal<Card[]>([]);
  readonly scans = signal<Scan[]>([]);
  readonly connection = signal<'checking' | 'connected' | 'unavailable'>('checking');
  readonly lastSync = signal<number | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly syncError = signal('');
  readonly formError = signal('');
  readonly message = signal('');
  readonly search = signal('');
  readonly filter = signal<'all' | 'granted' | 'denied'>('all');
  readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('cardDialog');
  readonly now = new Date();
  readonly results: Record<ScanResult, string> = {
    granted: 'Granted', unknown: 'Unknown card', revoked: 'Revoked card', unavailable: 'Check unavailable',
  };

  readonly cardsByUid = computed(() => new Map(this.cards().map(card => [card.uid, card])));
  readonly activeCount = computed(() => this.cards().filter(card => card.active).length);
  readonly grantedCount = computed(() => this.scans().filter(scan => scan.result === 'granted').length);
  readonly matchingCards = computed(() => {
    const term = this.search().trim().toLowerCase();
    const uidTerm = normalizeUid(term);
    return this.cards().filter(card =>
      card.label.toLowerCase().includes(term) || (uidTerm && card.uid.includes(uidTerm)));
  });
  readonly visibleScans = computed(() => {
    if (this.page() === 'Overview') return this.scans().slice(0, 7);
    const filter = this.filter();
    return this.scans().filter(scan => filter === 'all' || (filter === 'granted') === (scan.result === 'granted'));
  });

  email = '';
  password = '';
  cardUid = '';
  cardLabel = '';
  private config?: Awaited<ReturnType<typeof ParkingApi.loadConfig>>;
  private timer?: ReturnType<typeof setInterval>;
  private pendingLoad?: Promise<void>;
  private dataVersion = 0;

  constructor() {
    void this.configure();
  }

  ngOnDestroy(): void {
    this.signOut();
  }

  async configure(): Promise<void> {
    this.error.set('');
    try {
      this.config = await ParkingApi.loadConfig();
      this.ready.set(true);
    } catch {
      this.error.set('Add the Firebase project settings to web/public/firebase-config.json, then retry.');
    }
  }

  async signIn(): Promise<void> {
    if (!this.config || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.api.set(await ParkingApi.signIn(this.config, this.email.trim(), this.password));
      this.timer = setInterval(() => void this.reload(), 5000);
      await this.reload();
    } catch (error) {
      this.error.set(this.readError(error, 'Could not sign in. Check your connection and retry.'));
    } finally {
      this.password = '';
      this.busy.set(false);
    }
  }

  signOut(): void {
    clearInterval(this.timer);
    this.dialog()?.nativeElement.close();
    this.api()?.close();
    this.api.set(null);
    this.pendingLoad = undefined;
    this.cards.set([]);
    this.scans.set([]);
    this.lastSync.set(null);
    this.connection.set('checking');
    this.syncError.set('');
    this.busy.set(false);
    this.goTo('Overview');
  }

  goTo(page: Page): void {
    this.page.set(page);
    this.error.set('');
    this.message.set('');
    this.search.set('');
    this.filter.set('all');
  }

  async reload(): Promise<void> {
    const api = this.api();
    if (!api) return;
    if (this.pendingLoad) return this.pendingLoad;
    const version = this.dataVersion;
    const load = Promise.all([api.listCards(), api.listScans()])
      .then(([cards, scans]) => {
        if (api !== this.api()) return;
        if (this.dataVersion === version) this.cards.set(cards);
        this.scans.set(scans);
        this.lastSync.set(Date.now());
        this.connection.set('connected');
        this.syncError.set('');
      })
      .catch(error => {
        if (api !== this.api()) return;
        this.connection.set('unavailable');
        this.syncError.set(this.readError(error, 'Could not reach Firebase. Scan data may be out of date.'));
      })
      .finally(() => {
        if (this.pendingLoad === load) this.pendingLoad = undefined;
      });
    this.pendingLoad = load;
    return load;
  }

  openCard(uid = ''): void {
    this.cardUid = uid;
    this.cardLabel = '';
    this.formError.set('');
    this.dialog()?.nativeElement.showModal();
  }

  closeCard(): void {
    if (!this.busy()) this.dialog()?.nativeElement.close();
  }

  async registerCard(): Promise<void> {
    const api = this.api();
    if (!api || this.busy()) return;
    const uid = normalizeUid(this.cardUid);
    const label = this.cardLabel.trim();
    this.formError.set('');
    if (!isCardUid(uid)) {
      this.formError.set('Enter a hexadecimal UID with 8, 14, or 20 characters.');
      return;
    }
    if (!label || label.length > 80) {
      this.formError.set('Enter a card label up to 80 characters.');
      return;
    }
    if (this.cardsByUid().has(uid)) {
      this.formError.set('That UID is already registered. You can change its access in Cards.');
      return;
    }

    this.busy.set(true);
    try {
      const card = await api.register(uid, label);
      if (api !== this.api()) return;
      this.dataVersion++;
      this.cards.update(cards => [...cards, card].sort((a, b) => a.label.localeCompare(b.label)));
      this.dialog()?.nativeElement.close();
      this.message.set(label + ' now has parking access.');
    } catch (error) {
      if (api !== this.api()) return;
      await this.reload();
      const message = this.cardsByUid().has(uid)
        ? 'That UID is already registered. You can change its access in Cards.'
        : this.readError(error, 'Could not register this card. Try again.');
      this.formError.set(message);
    } finally {
      if (api === this.api()) this.busy.set(false);
    }
  }

  async changeAccess(card: Card): Promise<void> {
    const api = this.api();
    if (!api || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await api.setActive(card.uid, !card.active);
      if (api !== this.api()) return;
      this.dataVersion++;
      this.cards.update(cards => cards.map(item => item.uid === card.uid ? { ...item, active: !card.active } : item));
      this.message.set(card.active ? card.label + ' was revoked.' : card.label + ' was reactivated.');
    } catch (error) {
      if (api === this.api()) this.error.set(this.readError(error, 'Could not update access. Try again.'));
    } finally {
      if (api === this.api()) this.busy.set(false);
    }
  }

  private readError(error: unknown, fallback: string): string {
    return error instanceof Error && ['Error'].includes(error.name) ? error.message : fallback;
  }
}
