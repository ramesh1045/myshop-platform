import { Component, Injectable, Pipe, PipeTransform, input, output, signal, computed } from '@angular/core';

// ------------------------------------------------------------------ toast
@Injectable({ providedIn: 'root' })
export class Toast {
  readonly items = signal<{ id: number; text: string; kind: 'ok' | 'err' }[]>([]);
  private n = 0;
  ok(text: string) { this.push(text, 'ok'); }
  err(text: string) { this.push(text, 'err'); }
  private push(text: string, kind: 'ok' | 'err') {
    const id = ++this.n;
    this.items.update((l) => [...l, { id, text, kind }]);
    setTimeout(() => this.items.update((l) => l.filter((i) => i.id !== id)), 4000);
  }
}

@Component({
  selector: 'ms-toasts',
  template: `<div class="toasts">@for (t of toast.items(); track t.id) {<div class="toast" [class.err]="t.kind==='err'">{{ t.text }}</div>}</div>`,
})
export class ToastsComponent {
  constructor(public toast: Toast) {}
}

// ------------------------------------------------------------------ INR money
@Pipe({ name: 'inr' })
export class InrPipe implements PipeTransform {
  transform(v: number | string | null | undefined): string {
    const n = Number(v ?? 0);
    return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
}

// ------------------------------------------------------------------ status badge
@Component({
  selector: 'ms-badge',
  template: `<span class="badge" [attr.data-v]="value()">{{ value() }}</span>`,
})
export class BadgeComponent { value = input<string>(''); }

// ------------------------------------------------------------------ offset pager (admin pages — PDF §8)
@Component({
  selector: 'ms-pager',
  template: `
    @if (totalPages() > 1) {
      <div class="pager">
        <button class="btn sm" [disabled]="page() <= 1" (click)="go.emit(page() - 1)">‹ Prev</button>
        <span>Page {{ page() }} of {{ totalPages() }} · {{ total() }} records</span>
        <button class="btn sm" [disabled]="page() >= totalPages()" (click)="go.emit(page() + 1)">Next ›</button>
      </div>
    } @else if (total() > 0) { <div class="pager muted">{{ total() }} records</div> }`,
})
export class PagerComponent {
  page = input(1); totalPages = input(1); total = input(0);
  go = output<number>();
}

// ------------------------------------------------------------------ simple bar chart (reports)
@Component({
  selector: 'ms-bars',
  template: `
    <div class="bars">
      @for (d of data(); track d.label) {
        <div class="bar-col" [title]="d.label + ': ' + d.value">
          <div class="bar" [style.height.%]="max() ? (d.value / max()) * 100 : 0"></div>
          <small>{{ d.label }}</small>
        </div>
      } @empty { <p class="muted">No data for this period.</p> }
    </div>`,
})
export class BarsComponent {
  data = input<{ label: string; value: number }[]>([]);
  max = computed(() => Math.max(0, ...this.data().map((d) => d.value)));
}

// ------------------------------------------------------------------ Razorpay checkout.js loader
let rzpLoading: Promise<void> | null = null;
export function loadRazorpay(): Promise<void> {
  if ((window as any).Razorpay) return Promise.resolve();
  rzpLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Razorpay'));
    document.head.appendChild(s);
  });
  return rzpLoading;
}

export async function openRazorpay(opts: { key: string; orderId: string; amount: number; name: string; description?: string;
  prefill?: { name?: string; email?: string; contact?: string }; color?: string }): Promise<{ razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }> {
  await loadRazorpay();
  return new Promise((resolve, reject) => {
    const rzp = new (window as any).Razorpay({
      key: opts.key, order_id: opts.orderId, amount: Math.round(opts.amount * 100), currency: 'INR',
      name: opts.name, description: opts.description, prefill: opts.prefill, theme: { color: opts.color || '#1f6feb' },
      handler: (r: any) => resolve(r),
      modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
    });
    rzp.open();
  });
}

export const SHARED_UI = [InrPipe, BadgeComponent, PagerComponent, BarsComponent];
