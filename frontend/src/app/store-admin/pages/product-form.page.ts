import { Component, OnInit, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Api, errMsg } from '../../shared/api.service';
import { Toast } from '../../shared/ui';
import { AdminSession } from '../admin-session';

@Component({
  selector: 'sa-product-form',
  imports: [FormsModule, RouterLink, DragDropModule],
  template: `
    <div class="page-head"><a routerLink="/admin/products" class="btn sm">‹ Back</a><h1>{{ isNew() ? 'Add product' : f.name }}</h1></div>
    <form class="grid c2" (ngSubmit)="save()" style="grid-template-columns: 2fr 1fr">
      <div class="stack">
        <div class="card stack">
          <label class="field"><span>Name*</span><input [(ngModel)]="f.name" name="name" required /></label>
          <label class="field"><span>Short description</span><input [(ngModel)]="f.shortDescription" name="sd" maxlength="500" /></label>
          <label class="field"><span>Description (HTML allowed)</span><textarea [(ngModel)]="f.description" name="d" rows="8"></textarea></label>
        </div>
        <div class="card stack">
          <h3>Images</h3>
          @if (isNew()) { <p class="muted">Save the product first, then add images.</p> } @else {
            <div cdkDropList cdkDropListOrientation="horizontal" (cdkDropListDropped)="reorder($event)" class="row">
              @for (img of images(); track img.id) {
                <div cdkDrag class="img-tile"><img [src]="img.url" alt="" /><button type="button" class="btn sm danger" (click)="removeImg(img)">✕</button></div>
              }
            </div>
            <label class="btn"><span class="mi">upload</span> Upload image<input type="file" accept="image/*" hidden (change)="upload($event)" /></label>
            <small class="muted">Drag to reorder; the first image is the main image.</small>
          }
        </div>
        <div class="card stack">
          <h3>SEO</h3>
          <label class="field"><span>URL slug</span><input [(ngModel)]="f.slug" name="slug" /></label>
          <label class="field"><span>SEO title</span><input [(ngModel)]="f.seoTitle" name="st" /></label>
          <label class="field"><span>SEO description</span><textarea [(ngModel)]="f.seoDescription" name="sdesc"></textarea></label>
        </div>
      </div>
      <div class="stack">
        <div class="card stack">
          <label class="field"><span>Status</span><select [(ngModel)]="f.status" name="status"><option>DRAFT</option><option>ACTIVE</option><option>ARCHIVED</option></select></label>
          <label class="field"><span>Category</span><select [(ngModel)]="f.categoryId" name="cat"><option [ngValue]="null">—</option>@for (c of cats(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select></label>
          <label class="check"><input type="checkbox" [(ngModel)]="f.isFeatured" name="feat" /> Featured on home page</label>
        </div>
        <div class="card stack">
          <label class="field"><span>Price (₹)*</span><input type="number" step="0.01" [(ngModel)]="f.price" name="price" required min="0" /></label>
          <label class="field"><span>MRP / compare at (₹)</span><input type="number" step="0.01" [(ngModel)]="f.compareAtPrice" name="mrp" /></label>
          <label class="field"><span>Cost price (₹)</span><input type="number" step="0.01" [(ngModel)]="f.costPrice" name="cost" /></label>
          <div class="grid c2"><label class="field"><span>GST %</span><select [(ngModel)]="f.gstRate" name="gst">@for (g of [0, 5, 12, 18, 28]; track g) { <option [ngValue]="g">{{ g }}%</option> }</select></label>
            <label class="field"><span>HSN code</span><input [(ngModel)]="f.hsnCode" name="hsn" /></label></div>
        </div>
        <div class="card stack">
          <label class="field"><span>SKU</span><input [(ngModel)]="f.sku" name="sku" /></label>
          <label class="check"><input type="checkbox" [(ngModel)]="f.trackInventory" name="ti" /> Track stock</label>
          @if (f.trackInventory) { <label class="field"><span>Stock quantity</span><input type="number" [(ngModel)]="f.stockQty" name="qty" /></label> }
          <label class="field"><span>Weight (grams)</span><input type="number" [(ngModel)]="f.weightGrams" name="w" /></label>
        </div>
        @if (s.can(isNew() ? 'PRODUCT_CREATE' : 'PRODUCT_EDIT')) { <button class="btn primary" [disabled]="busy()">Save product</button> }
      </div>
    </form>`,
  styles: [`.img-tile { position: relative; width: 96px; } .img-tile img { width: 96px; height: 110px; object-fit: cover; border-radius: 6px; cursor: grab; }
    .img-tile button { position: absolute; top: 4px; right: 4px; padding: 0 6px; }`],
})
export class ProductFormPage implements OnInit {
  id = input<string>();
  s = inject(AdminSession); private api = inject(Api); private toast = inject(Toast); private router = inject(Router);
  cats = signal<any[]>([]); images = signal<any[]>([]); busy = signal(false);
  isNew = () => !this.id() || this.id() === 'new';
  f: any = { name: '', slug: '', shortDescription: '', description: '', price: null, compareAtPrice: null, costPrice: null, categoryId: null,
    status: 'ACTIVE', isFeatured: false, gstRate: 5, hsnCode: '', sku: '', trackInventory: true, stockQty: 0, weightGrams: null, seoTitle: '', seoDescription: '' };

  async ngOnInit() {
    this.cats.set(await this.api.get('/api/admin/categories'));
    if (!this.isNew()) {
      const p = await this.api.get(`/api/admin/products/${this.id()}`);
      this.f = { name: p.name, slug: p.slug, shortDescription: p.short_description, description: p.description, price: p.price, compareAtPrice: p.compare_at_price,
        costPrice: p.cost_price, categoryId: p.category_id, status: p.status, isFeatured: p.is_featured, gstRate: Number(p.gst_rate), hsnCode: p.hsn_code, sku: p.sku,
        trackInventory: p.track_inventory, stockQty: p.stock_qty, weightGrams: p.weight_grams, seoTitle: p.seo_title, seoDescription: p.seo_description };
      this.images.set(p.images);
    }
  }
  async save() {
    this.busy.set(true);
    const body = { ...this.f, price: Number(this.f.price), compareAtPrice: this.f.compareAtPrice ? Number(this.f.compareAtPrice) : null,
      costPrice: this.f.costPrice ? Number(this.f.costPrice) : null, stockQty: Number(this.f.stockQty || 0), weightGrams: this.f.weightGrams ? Number(this.f.weightGrams) : null,
      slug: this.f.slug || undefined, sku: this.f.sku || null };
    try {
      if (this.isNew()) { const p = await this.api.post('/api/admin/products', body); this.toast.ok('Product created'); this.router.navigate(['/admin/products', p.id]); }
      else { await this.api.put(`/api/admin/products/${this.id()}`, body); this.toast.ok('Saved'); }
    } catch (e) { this.toast.err(errMsg(e)); } finally { this.busy.set(false); }
  }
  async upload(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const m = await this.api.upload('/api/admin/media', file);
      await this.api.post(`/api/admin/products/${this.id()}/images`, { url: m.url, storageKey: m.storageKey });
      this.images.set((await this.api.get(`/api/admin/products/${this.id()}`)).images);
    } catch (e) { this.toast.err(errMsg(e)); }
  }
  async removeImg(img: any) {
    await this.api.delete(`/api/admin/products/${this.id()}/images/${img.id}`);
    this.images.update((l) => l.filter((i) => i.id !== img.id));
  }
  async reorder(e: CdkDragDrop<any[]>) {
    const l = [...this.images()]; moveItemInArray(l, e.previousIndex, e.currentIndex); this.images.set(l);
    await this.api.put(`/api/admin/products/${this.id()}/images/order`, { imageIds: l.map((i) => i.id) });
  }
}
