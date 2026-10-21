import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Api, OffsetPage, errMsg } from '../../shared/api.service';
import { InrPipe, PagerComponent, Toast } from '../../shared/ui';

/** Coupons (PDF §12 phase 5) */
@Component({
  selector: 'sa-coupons',
  imports: [FormsModule, DatePipe, InrPipe, PagerComponent],
  template: `
    <div class="page-head"><h1>Coupons</h1><span class="spacer"></span><button class="btn primary" (click)="edit({})">New coupon</button></div>
    <div class="grid c2" style="grid-template-columns: 2fr 1fr">
      <div><div class="card" style="padding:0"><table class="table">
        <tr><th>Code</th><th>Discount</th><th>Min order</th><th>Valid</th><th class="num">Used</th><th>Active</th><th></th></tr>
        @for (c of page()?.items; track c.id) {
          <tr><td><b>{{ c.code }}</b></td><td>{{ c.discount_type === 'PERCENT' ? c.discount_value + '%' : (c.discount_value | inr) }}@if (c.max_discount) { (max {{ c.max_discount | inr }}) }</td>
            <td>{{ c.min_order_amount | inr }}</td><td><small>{{ c.starts_at | date: 'shortDate' }} – {{ c.ends_at | date: 'shortDate' }}</small></td>
            <td class="num">{{ c.used_count }}{{ c.usage_limit ? ' / ' + c.usage_limit : '' }}</td><td>{{ c.is_active ? 'Yes' : 'No' }}</td>
            <td><button class="btn sm" (click)="edit(c)">Edit</button> <button class="btn sm danger" (click)="remove(c)">Delete</button></td></tr>
        } @empty { <tr><td colspan="7" class="muted">No coupons.</td></tr> }
      </table></div>
      <ms-pager [page]="page()?.page ?? 1" [totalPages]="page()?.totalPages ?? 1" [total]="page()?.total ?? 0" (go)="load($event)" /></div>
      @if (f) {
        <form class="card stack" (ngSubmit)="save()">
          <label class="field"><span>Code</span><input [(ngModel)]="f.code" name="c" required /></label>
          <div class="grid c2"><label class="field"><span>Type</span><select [(ngModel)]="f.discountType" name="t"><option value="PERCENT">Percent</option><option value="FLAT">Flat ₹</option></select></label>
            <label class="field"><span>Value</span><input type="number" [(ngModel)]="f.discountValue" name="v" required /></label></div>
          <div class="grid c2"><label class="field"><span>Max discount ₹</span><input type="number" [(ngModel)]="f.maxDiscount" name="m" /></label>
            <label class="field"><span>Min order ₹</span><input type="number" [(ngModel)]="f.minOrderAmount" name="mo" /></label></div>
          <div class="grid c2"><label class="field"><span>Starts</span><input type="date" [(ngModel)]="f.startsAt" name="s" /></label>
            <label class="field"><span>Ends</span><input type="date" [(ngModel)]="f.endsAt" name="e" /></label></div>
          <div class="grid c2"><label class="field"><span>Total uses</span><input type="number" [(ngModel)]="f.usageLimit" name="u" /></label>
            <label class="field"><span>Per customer</span><input type="number" [(ngModel)]="f.usagePerCustomer" name="pc" /></label></div>
          <label class="check"><input type="checkbox" [(ngModel)]="f.isActive" name="a" /> Active</label>
          <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" (click)="f = null">Cancel</button></div>
        </form>
      }
    </div>`,
})
export class CouponsPage implements OnInit {
  page = signal<OffsetPage<any> | null>(null); f: any = null;
  private api = inject(Api); private toast = inject(Toast);
  ngOnInit() { this.load(1); }
  async load(p: number) { this.page.set(await this.api.get('/api/admin/coupons', { page: p })); }
  edit(c: any) {
    const d = (v: any) => (v ? String(v).slice(0, 10) : '');
    this.f = { id: c.id, code: c.code ?? '', discountType: c.discount_type ?? 'PERCENT', discountValue: c.discount_value ?? 10, maxDiscount: c.max_discount ?? null,
      minOrderAmount: c.min_order_amount ?? 0, startsAt: d(c.starts_at), endsAt: d(c.ends_at), usageLimit: c.usage_limit ?? null, usagePerCustomer: c.usage_per_customer ?? null, isActive: c.is_active ?? true };
  }
  async save() {
    const { id, ...b } = this.f;
    const n = (v: any) => (v === null || v === '' ? null : Number(v));
    const body = { ...b, discountValue: Number(b.discountValue), maxDiscount: n(b.maxDiscount), minOrderAmount: Number(b.minOrderAmount || 0),
      usageLimit: n(b.usageLimit), usagePerCustomer: n(b.usagePerCustomer), startsAt: b.startsAt || null, endsAt: b.endsAt || null };
    try { if (id) await this.api.put(`/api/admin/coupons/${id}`, body); else await this.api.post('/api/admin/coupons', body); this.f = null; this.load(1); this.toast.ok('Saved'); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
  async remove(c: any) { if (confirm(`Delete ${c.code}?`)) { await this.api.delete(`/api/admin/coupons/${c.id}`).catch((e) => this.toast.err(errMsg(e))); this.load(1); } }
}
