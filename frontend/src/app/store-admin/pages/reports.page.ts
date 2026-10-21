import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../shared/api.service';
import { InrPipe, BarsComponent } from '../../shared/ui';

/** Reports (PDF §12 phase 5) */
@Component({
  selector: 'sa-reports',
  imports: [FormsModule, InrPipe, BarsComponent],
  template: `
    <div class="page-head"><h1>Reports</h1><span class="spacer"></span>
      <input type="date" [(ngModel)]="from" style="width:auto" /><input type="date" [(ngModel)]="to" style="width:auto" /><button class="btn" (click)="load()">Apply</button></div>
    @if (r(); as r) {
      <div class="grid c4">
        <div class="card"><div class="muted">Revenue</div><div class="stat">{{ r.summary.revenue | inr }}</div></div>
        <div class="card"><div class="muted">Orders</div><div class="stat">{{ r.summary.orders }}</div></div>
        <div class="card"><div class="muted">Avg order value</div><div class="stat">{{ r.summary.avg_order_value | inr }}</div></div>
        <div class="card"><div class="muted">Discounts given</div><div class="stat">{{ r.summary.discounts | inr }}</div></div>
      </div>
      <div class="card mt"><h3>Daily revenue</h3><ms-bars [data]="daily()" /></div>
      <div class="grid c3 mt">
        <div class="card"><h3>Top products</h3><table class="table">@for (p of r.topProducts; track p.product_id) { <tr><td>{{ p.product_name }}</td><td class="num">{{ p.qty }}</td><td class="num">{{ p.revenue | inr }}</td></tr> }</table></div>
        <div class="card"><h3>By status</h3><table class="table">@for (s of r.byStatus; track s.status) { <tr><td>{{ s.status }}</td><td class="num">{{ s.n }}</td></tr> }</table></div>
        <div class="card"><h3>By payment</h3><table class="table">@for (s of r.byPayment; track s.payment_method) { <tr><td>{{ s.payment_method }}</td><td class="num">{{ s.n }}</td><td class="num">{{ s.amount | inr }}</td></tr> }</table></div>
      </div>
    }`,
})
export class ReportsPage implements OnInit {
  private api = inject(Api);
  r = signal<any>(null);
  from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10); to = new Date().toISOString().slice(0, 10);
  daily = computed(() => (this.r()?.daily ?? []).map((d: any) => ({ label: String(d.day).slice(5, 10), value: Number(d.revenue) })));
  ngOnInit() { this.load(); }
  async load() { this.r.set(await this.api.get('/api/admin/reports/sales', { from: this.from, to: this.to })); }
}
