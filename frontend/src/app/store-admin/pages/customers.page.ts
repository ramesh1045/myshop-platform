import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Api, OffsetPage } from '../../shared/api.service';
import { InrPipe, BadgeComponent, PagerComponent, Toast } from '../../shared/ui';
import { AdminSession } from '../admin-session';

@Component({
  selector: 'sa-customers',
  imports: [RouterLink, FormsModule, DatePipe, InrPipe, BadgeComponent, PagerComponent],
  template: `
    <div class="page-head"><h1>Customers</h1></div>
    <div class="filters"><input placeholder="Name, mobile or email" [(ngModel)]="q" (keyup.enter)="load(1)" /></div>
    <div class="grid c2" style="grid-template-columns: 3fr 2fr">
      <div>
        <div class="card" style="padding:0"><table class="table">
          <tr><th>Name</th><th>Mobile</th><th class="num">Orders</th><th class="num">Spent</th><th>Status</th></tr>
          @for (c of page()?.items; track c.id) {
            <tr (click)="open(c.id)" style="cursor:pointer"><td>{{ c.name }}<br /><small class="muted">{{ c.email }}</small></td><td>{{ c.mobile }}</td>
              <td class="num">{{ c.order_count }}</td><td class="num">{{ c.total_spent | inr }}</td><td><ms-badge [value]="c.status" /></td></tr>
          } @empty { <tr><td colspan="5" class="muted">No customers yet.</td></tr> }
        </table></div>
        <ms-pager [page]="page()?.page ?? 1" [totalPages]="page()?.totalPages ?? 1" [total]="page()?.total ?? 0" (go)="load($event)" />
      </div>
      @if (c(); as c) {
        <div class="card stack">
          <h3>{{ c.name }}</h3><p class="muted">{{ c.mobile }} · {{ c.email }} · since {{ c.created_at | date: 'mediumDate' }}</p>
          @if (s.can('CUSTOMER_MANAGE')) {
            <button class="btn sm" (click)="toggle(c)">{{ c.status === 'ACTIVE' ? 'Block customer' : 'Unblock' }}</button>
          }
          <h3>Orders</h3>
          @for (o of c.orders; track o.id) { <div class="row between"><a [routerLink]="['/admin/orders', o.id]">{{ o.order_number }}</a><ms-badge [value]="o.status" /><span>{{ o.grand_total | inr }}</span></div> }
          <h3>Addresses</h3>
          @for (a of c.addresses; track a.id) { <p>{{ a.name }}, {{ a.line1 }}, {{ a.city }} {{ a.pincode }}</p> }
        </div>
      }
    </div>`,
})
export class CustomersPage implements OnInit {
  s = inject(AdminSession); private api = inject(Api); private toast = inject(Toast);
  page = signal<OffsetPage<any> | null>(null); c = signal<any>(null); q = '';
  ngOnInit() { this.load(1); }
  async load(page: number) { this.page.set(await this.api.get('/api/admin/customers', { page, q: this.q })); }
  async open(id: number) { this.c.set(await this.api.get(`/api/admin/customers/${id}`)); }
  async toggle(c: any) {
    await this.api.put(`/api/admin/customers/${c.id}/status`, { status: c.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE' });
    this.toast.ok('Updated'); this.open(c.id); this.load(this.page()!.page);
  }
}
