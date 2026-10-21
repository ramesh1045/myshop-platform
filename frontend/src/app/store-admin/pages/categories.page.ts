import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errMsg } from '../../shared/api.service';
import { Toast } from '../../shared/ui';

@Component({
  selector: 'sa-categories',
  imports: [FormsModule],
  template: `
    <div class="page-head"><h1>Categories</h1><span class="spacer"></span><button class="btn primary" (click)="edit({})">Add category</button></div>
    <div class="grid c2" style="grid-template-columns: 2fr 1fr">
      <div class="card" style="padding:0">
        <table class="table">
          <tr><th>Name</th><th>Parent</th><th class="num">Products</th><th class="num">Order</th><th>Active</th><th></th></tr>
          @for (c of list(); track c.id) {
            <tr><td>{{ c.name }}<br /><small class="muted">/category/{{ c.slug }}</small></td><td>{{ parentName(c.parent_id) }}</td>
              <td class="num">{{ c.product_count }}</td><td class="num">{{ c.sort_order }}</td><td>{{ c.is_active ? 'Yes' : 'No' }}</td>
              <td><button class="btn sm" (click)="edit(c)">Edit</button> <button class="btn sm danger" (click)="remove(c)">Delete</button></td></tr>
          } @empty { <tr><td colspan="6" class="muted">No categories yet.</td></tr> }
        </table>
      </div>
      @if (f) {
        <form class="card stack" (ngSubmit)="save()">
          <h3>{{ f.id ? 'Edit' : 'New' }} category</h3>
          <label class="field"><span>Name</span><input [(ngModel)]="f.name" name="n" required /></label>
          <label class="field"><span>Slug</span><input [(ngModel)]="f.slug" name="s" /></label>
          <label class="field"><span>Parent</span><select [(ngModel)]="f.parentId" name="p"><option [ngValue]="null">— none —</option>
            @for (c of list(); track c.id) { @if (c.id !== f.id) { <option [ngValue]="c.id">{{ c.name }}</option> } }</select></label>
          <label class="field"><span>Image</span><input [(ngModel)]="f.imageUrl" name="i" placeholder="https://…" /></label>
          <label class="btn sm"><span class="mi">upload</span> Upload<input type="file" accept="image/*" hidden (change)="upload($event)" /></label>
          <label class="field"><span>Sort order</span><input type="number" [(ngModel)]="f.sortOrder" name="o" /></label>
          <label class="check"><input type="checkbox" [(ngModel)]="f.isActive" name="a" /> Active</label>
          <label class="field"><span>Description</span><textarea [(ngModel)]="f.description" name="d"></textarea></label>
          <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" (click)="f = null">Cancel</button></div>
        </form>
      }
    </div>`,
})
export class CategoriesPage implements OnInit {
  list = signal<any[]>([]); f: any = null;
  private api = inject(Api); private toast = inject(Toast);
  ngOnInit() { this.load(); }
  async load() { this.list.set(await this.api.get('/api/admin/categories')); }
  parentName(id: number | null) { return this.list().find((c) => c.id === id)?.name ?? ''; }
  edit(c: any) {
    this.f = { id: c.id, name: c.name ?? '', slug: c.slug ?? '', parentId: c.parent_id ?? null, imageUrl: c.image_url ?? '', sortOrder: c.sort_order ?? 0,
      isActive: c.is_active ?? true, description: c.description ?? '' };
  }
  async upload(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (file) this.f.imageUrl = (await this.api.upload('/api/admin/media', file)).url;
  }
  async save() {
    const { id, ...b } = this.f;
    const body = { ...b, slug: b.slug || undefined, imageUrl: b.imageUrl || null, sortOrder: Number(b.sortOrder || 0) };
    try {
      if (id) await this.api.put(`/api/admin/categories/${id}`, body); else await this.api.post('/api/admin/categories', body);
      this.toast.ok('Saved'); this.f = null; this.load();
    } catch (e) { this.toast.err(errMsg(e)); }
  }
  async remove(c: any) {
    if (!confirm(`Delete category "${c.name}"? Products stay, but lose this category.`)) return;
    await this.api.delete(`/api/admin/categories/${c.id}`); this.load();
  }
}
