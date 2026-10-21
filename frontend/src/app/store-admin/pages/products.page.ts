import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api, OffsetPage, errMsg } from '../../shared/api.service';
import { InrPipe, BadgeComponent, PagerComponent, Toast } from '../../shared/ui';
import { AdminSession } from '../admin-session';

/** Admin list -> offset pagination with page numbers + total (PDF §8) */
@Component({
  selector: 'sa-products',
  imports: [RouterLink, FormsModule, InrPipe, BadgeComponent, PagerComponent],
  template: `
    <div class="page-head"><h1>Products</h1><span class="spacer"></span>
      @if (s.can('PRODUCT_CREATE')) { <a class="btn primary" routerLink="/admin/products/new"><span class="mi">add</span> Add product</a> }</div>
    <div class="filters">
      <input placeholder="Search name or SKU" [(ngModel)]="q" (keyup.enter)="load(1)" />
      <select [(ngModel)]="status" (change)="load(1)"><option value="">All status</option><option>ACTIVE</option><option>DRAFT</option><option>ARCHIVED</option></select>
      <select [(ngModel)]="categoryId" (change)="load(1)"><option value="">All categories</option>@for (c of cats(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select>
      <label class="check"><input type="checkbox" [(ngModel)]="lowStock" (change)="load(1)" /> Low stock</label>
    </div>
    <div class="card table-wrap" style="padding:0">
      <table class="table">
        <tr><th></th><th>Name</th><th>SKU</th><th>Category</th><th class="num">Price</th><th class="num">Stock</th><th>Status</th><th></th></tr>
        @for (p of page()?.items; track p.id) {
          <tr>
            <td><img class="thumb" [src]="p.images[0]?.url || ''" alt="" /></td>
            <td><a [routerLink]="['/admin/products', p.id]">{{ p.name }}</a>@if (p.is_featured) { <span class="mi" title="Featured" style="font-size:16px;color:#f59e0b">star</span> }</td>
            <td>{{ p.sku }}</td><td>{{ p.category_name }}</td><td class="num">{{ p.price | inr }}</td>
            <td class="num" [style.color]="p.track_inventory && p.stock_qty <= 5 ? '#dc2626' : ''">{{ p.track_inventory ? p.stock_qty : '∞' }}</td>
            <td><ms-badge [value]="p.status" /></td>
            <td>@if (s.can('PRODUCT_DELETE')) { <button class="btn sm danger" (click)="remove(p)">Delete</button> }</td>
          </tr>
        } @empty { <tr><td colspan="8" class="muted">No products.</td></tr> }
      </table>
    </div>
    <ms-pager [page]="page()?.page ?? 1" [totalPages]="page()?.totalPages ?? 1" [total]="page()?.total ?? 0" (go)="load($event)" />`,
})
export class ProductsPage implements OnInit {
  s = inject(AdminSession); private api = inject(Api); private toast = inject(Toast);
  page = signal<OffsetPage<any> | null>(null); cats = signal<any[]>([]);
  q = ''; status = ''; categoryId = ''; lowStock = false;
  async ngOnInit() { this.load(1); this.cats.set(await this.api.get('/api/admin/categories').catch(() => [])); }
  async load(page: number) {
    this.page.set(await this.api.get('/api/admin/products', { page, q: this.q, status: this.status, categoryId: this.categoryId, lowStock: this.lowStock ? 1 : undefined }));
  }
  async remove(p: any) {
    if (!confirm(`Delete "${p.name}"? Products with orders are archived instead.`)) return;
    try { const r = await this.api.delete(`/api/admin/products/${p.id}`); this.toast.ok(r?.archived ? 'Archived (has orders)' : 'Deleted'); this.load(this.page()!.page); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
}
