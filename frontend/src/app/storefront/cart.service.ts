import { Injectable, computed, signal, effect } from '@angular/core';

export interface CartLine { productId: number; name: string; slug: string; price: number; image?: string; quantity: number; maxQty?: number | null }

/** Cart lives in the browser per store host; prices are re-checked by the server at checkout. */
@Injectable({ providedIn: 'root' })
export class CartService {
  private key = `ms:${location.host}:cart`;
  readonly lines = signal<CartLine[]>(this.read());
  readonly count = computed(() => this.lines().reduce((a, l) => a + l.quantity, 0));
  readonly subtotal = computed(() => Math.round(this.lines().reduce((a, l) => a + l.price * l.quantity, 0) * 100) / 100);

  constructor() {
    effect(() => { try { localStorage.setItem(this.key, JSON.stringify(this.lines())); } catch { /* ignore */ } });
  }
  private read(): CartLine[] {
    try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch { return []; }
  }
  add(p: { id: number; name: string; slug: string; price: number; images?: { url: string }[]; stock_qty?: number; track_inventory?: boolean }, qty = 1) {
    this.lines.update((ls) => {
      const max = p.track_inventory ? p.stock_qty ?? null : null;
      const ex = ls.find((l) => l.productId === p.id);
      if (ex) return ls.map((l) => l.productId === p.id ? { ...l, quantity: Math.min(l.quantity + qty, max ?? 999) } : l);
      return [...ls, { productId: p.id, name: p.name, slug: p.slug, price: Number(p.price), image: p.images?.[0]?.url, quantity: Math.min(qty, max ?? 999), maxQty: max }];
    });
  }
  setQty(id: number, q: number) {
    this.lines.update((ls) => ls.map((l) => l.productId === id ? { ...l, quantity: Math.max(1, Math.min(q, l.maxQty ?? 999)) } : l));
  }
  remove(id: number) { this.lines.update((ls) => ls.filter((l) => l.productId !== id)); }
  /** Server re-pricing: removes unavailable products, updates price/stock */
  sync(rows: any[]) {
    this.lines.update((ls) => ls.filter((l) => rows.some((r) => r.id === l.productId)).map((l) => {
      const r = rows.find((x) => x.id === l.productId)!;
      const max = r.track_inventory ? r.stock_qty : null;
      return { ...l, price: Number(r.price), maxQty: max, quantity: Math.min(l.quantity, max ?? 999) };
    }).filter((l) => l.quantity > 0));
  }
  clear() { this.lines.set([]); }
}
