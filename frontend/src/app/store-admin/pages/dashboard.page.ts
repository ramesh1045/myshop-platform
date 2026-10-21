import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { Api } from '../../shared/api.service';
import { InrPipe, BadgeComponent } from '../../shared/ui';
import { AdminSession } from '../admin-session';

@Component({
  selector: 'sa-dashboard',
  imports: [RouterLink, DatePipe, InrPipe, BadgeComponent],
  template: `
    <div class="page-head"><h1>Dashboard</h1></div>
    @if (d(); as d) {
      <div class="grid c4">
        <div class="card"><div class="muted">Today's orders</div><div class="stat">{{ d.today.orders }}</div><div>{{ d.today.revenue | inr }}</div></div>
        <div class="card"><div class="muted">This month</div><div class="stat">{{ d.month.revenue | inr }}</div><div>{{ d.month.orders }} orders</div></div>
        <div class="card"><div class="muted">Pending orders</div><div class="stat">{{ d.pendingOrders }}</div>@if (s.can('ORDER_VIEW')) {<a routerLink="/admin/orders" [queryParams]="{ status: 'PENDING' }">View</a>}</div>
        <div class="card"><div class="muted">Low stock</div><div class="stat">{{ d.lowStock }}</div><div>{{ d.products }} products · {{ d.customers }} customers</div></div>
      </div>
      <div class="card mt">
        <h3>Recent orders</h3>
        <table class="table">
          <tr><th>Order</th><th>Customer</th><th>Status</th><th class="num">Total</th><th>Date</th></tr>
          @for (o of d.recentOrders; track o.id) {
            <tr><td>@if (s.can('ORDER_VIEW')) {<a [routerLink]="['/admin/orders', o.id]">{{ o.order_number }}</a>} @else {{{ o.order_number }}}</td>
              <td>{{ o.customer_name }}</td><td><ms-badge [value]="o.status" /></td><td class="num">{{ o.grand_total | inr }}</td><td>{{ o.placed_at | date: 'short' }}</td></tr>
          } @empty { <tr><td colspan="5" class="muted">No orders yet — share your store link to get the first one!</td></tr> }
        </table>
      </div>
    }`,
})
export class DashboardPage implements OnInit {
  d = signal<any>(null); s = inject(AdminSession);
  private api = inject(Api);
  async ngOnInit() { this.d.set(await this.api.get('/api/admin/dashboard')); }
}
