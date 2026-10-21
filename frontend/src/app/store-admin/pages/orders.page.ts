import { Component, OnInit, inject, input, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Api, OffsetPage, errMsg } from '../../shared/api.service';
import { InrPipe, BadgeComponent, PagerComponent, Toast } from '../../shared/ui';
import { AdminSession } from '../admin-session';

const NEXT: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['PACKED', 'SHIPPED', 'CANCELLED'], PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'RETURNED'], DELIVERED: ['RETURNED'], CANCELLED: [], RETURNED: [],
};

/** Billing Staff typically see ONLY this page (PDF §3 step 7) */
@Component({
  selector: 'sa-orders',
  imports: [RouterLink, FormsModule, DatePipe, InrPipe, BadgeComponent, PagerComponent],
  template: `
    <div class="page-head"><h1>Orders</h1></div>
    <div class="filters">
      <input placeholder="Order no, name or mobile" [(ngModel)]="q" (keyup.enter)="load(1)" />
      <select [(ngModel)]="status" (change)="load(1)"><option value="">All status</option>@for (s of statuses; track s) { <option>{{ s }}</option> }</select>
      <select [(ngModel)]="paymentStatus" (change)="load(1)"><option value="">All payments</option><option>PENDING</option><option>PAID</option><option>FAILED</option><option>REFUNDED</option></select>
      <input type="date" [(ngModel)]="from" (change)="load(1)" /><input type="date" [(ngModel)]="to" (change)="load(1)" />
    </div>
    <div class="card table-wrap" style="padding:0">
      <table class="table">
        <tr><th>Order</th><th>Customer</th><th>Payment</th><th>Status</th><th class="num">Total</th><th>Placed</th></tr>
        @for (o of page()?.items; track o.id) {
          <tr><td><a [routerLink]="['/admin/orders', o.id]">{{ o.order_number }}</a></td><td>{{ o.customer_name }}<br /><small class="muted">{{ o.customer_mobile }}</small></td>
            <td>{{ o.payment_method }} <ms-badge [value]="o.payment_status" /></td><td><ms-badge [value]="o.status" /></td>
            <td class="num">{{ o.grand_total | inr }}</td><td>{{ o.placed_at | date: 'short' }}</td></tr>
        } @empty { <tr><td colspan="6" class="muted">No orders.</td></tr> }
      </table>
    </div>
    <ms-pager [page]="page()?.page ?? 1" [totalPages]="page()?.totalPages ?? 1" [total]="page()?.total ?? 0" (go)="load($event)" />`,
})
export class OrdersPage implements OnInit {
  statuses = Object.keys(NEXT);
  page = signal<OffsetPage<any> | null>(null);
  q = ''; status = inject(ActivatedRoute).snapshot.queryParamMap.get('status') ?? ''; paymentStatus = ''; from = ''; to = '';
  private api = inject(Api);
  ngOnInit() { this.load(1); }
  async load(page: number) {
    this.page.set(await this.api.get('/api/admin/orders', { page, q: this.q, status: this.status, paymentStatus: this.paymentStatus, from: this.from, to: this.to }));
  }
}

@Component({
  selector: 'sa-order-detail',
  imports: [RouterLink, FormsModule, DatePipe, InrPipe, BadgeComponent],
  template: `
    @if (o(); as o) {
      <div class="page-head no-print"><a routerLink="/admin/orders" class="btn sm">‹ Orders</a><h1>{{ o.order_number }}</h1><ms-badge [value]="o.status" />
        <span class="spacer"></span><button class="btn sm" (click)="print()"><span class="mi">print</span> Print invoice</button></div>
      <div class="grid c2" style="grid-template-columns: 2fr 1fr">
        <div class="stack">
          <div class="card">
            <table class="table">
              <tr><th>Item</th><th>HSN</th><th class="num">Price</th><th class="num">Qty</th><th class="num">GST</th><th class="num">Total</th></tr>
              @for (i of o.items; track i.id) {
                <tr><td>{{ i.product_name }}<br /><small class="muted">{{ i.sku }}</small></td><td>{{ i.hsn_code }}</td><td class="num">{{ i.unit_price | inr }}</td>
                  <td class="num">{{ i.quantity }}</td><td class="num">{{ i.gst_rate }}% · {{ i.tax_amount | inr }}</td><td class="num">{{ i.line_total | inr }}</td></tr>
              }
              <tr><td colspan="5" class="num">Subtotal</td><td class="num">{{ o.subtotal | inr }}</td></tr>
              @if (o.discount_total > 0) { <tr><td colspan="5" class="num">Discount ({{ o.coupon_code }})</td><td class="num">− {{ o.discount_total | inr }}</td></tr> }
              <tr><td colspan="5" class="num">Shipping</td><td class="num">{{ o.shipping_fee | inr }}</td></tr>
              <tr><td colspan="5" class="num">GST (incl.)</td><td class="num">{{ o.tax_total | inr }}</td></tr>
              <tr><td colspan="5" class="num"><b>Grand total</b></td><td class="num"><b>{{ o.grand_total | inr }}</b></td></tr>
            </table>
          </div>
          <div class="card"><h3>Timeline</h3>
            @for (h of o.history; track h.id) { <div><ms-badge [value]="h.to_status" /> {{ h.created_at | date: 'medium' }} @if (h.note) { — {{ h.note }} }</div> }
          </div>
        </div>
        <div class="stack">
          <div class="card"><h3>Customer</h3><p><b>{{ o.customer_name }}</b><br />{{ o.customer_mobile }}<br />{{ o.customer_email }}</p>
            <h3>Ship to</h3><p>{{ o.ship_line1 }}<br />@if (o.ship_line2) {{{ o.ship_line2 }}<br />}{{ o.ship_city }}, {{ o.ship_state }} {{ o.ship_pincode }}</p>
            @if (o.notes) { <p class="muted">Note: {{ o.notes }}</p> }</div>
          <div class="card"><h3>Payment</h3><p>{{ o.payment_method }} · <ms-badge [value]="o.payment_status" /></p>
            @for (p of o.payments; track $index) { <small class="muted">{{ p.provider }} {{ p.provider_payment_id }} {{ p.status }}</small> }</div>
          @if (next().length && s.can('ORDER_UPDATE', 'ORDER_CANCEL')) {
            <div class="card stack no-print"><h3>Update status</h3>
              <select [(ngModel)]="to">@for (n of next(); track n) { @if (n !== 'CANCELLED' || s.can('ORDER_CANCEL')) { <option>{{ n }}</option> } }</select>
              @if (to === 'SHIPPED') { <input placeholder="Courier name" [(ngModel)]="courier" /><input placeholder="Tracking number" [(ngModel)]="tracking" /> }
              <input placeholder="Note (optional)" [(ngModel)]="note" />
              <button class="btn primary" (click)="update()">Update</button>
            </div>
          }
        </div>
      </div>
    }`,
})
export class OrderDetailPage implements OnInit {
  id = input.required<string>();
  s = inject(AdminSession); private api = inject(Api); private toast = inject(Toast);
  o = signal<any>(null); next = signal<string[]>([]);
  to = ''; note = ''; courier = ''; tracking = '';
  ngOnInit() { this.load(); }
  async load() {
    const o = await this.api.get(`/api/admin/orders/${this.id()}`);
    this.o.set(o); this.next.set(NEXT[o.status] ?? []); this.to = this.next()[0] ?? '';
    this.courier = o.courier_name ?? ''; this.tracking = o.tracking_number ?? '';
  }
  async update() {
    try {
      await this.api.put(`/api/admin/orders/${this.id()}/status`, { status: this.to, note: this.note || null,
        courierName: this.to === 'SHIPPED' ? this.courier || null : undefined, trackingNumber: this.to === 'SHIPPED' ? this.tracking || null : undefined });
      this.toast.ok(`Order ${this.to}`); this.note = ''; this.load();
    } catch (e) { this.toast.err(errMsg(e)); }
  }
  print() { window.print(); }
}
