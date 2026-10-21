import { Component, OnInit, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe, JsonPipe, KeyValuePipe } from '@angular/common';
import { Api, OffsetPage, errMsg } from '../../shared/api.service';
import { BadgeComponent, InrPipe, PagerComponent, Toast } from '../../shared/ui';
import { SectionEditorComponent, Section } from '../section-editor';

// ------------------------------------------------------------------ PAGES (page builder, PDF §9)
@Component({
  selector: 'sa-pages',
  imports: [RouterLink, FormsModule, DatePipe, BadgeComponent],
  template: `
    <div class="page-head"><h1>Pages</h1><span class="spacer"></span>
      <input [(ngModel)]="title" placeholder="New page title e.g. Gallery" style="width:240px" /><button class="btn primary" (click)="create()">Create page</button></div>
    <div class="card" style="padding:0"><table class="table">
      <tr><th>Title</th><th>URL</th><th>Status</th><th>In menu</th><th>Updated</th><th></th></tr>
      @for (p of list(); track p.id) {
        <tr><td><a [routerLink]="['/admin/pages', p.id]">{{ p.title }}</a></td><td>/page/{{ p.slug }}</td><td><ms-badge [value]="p.status" /></td>
          <td>{{ p.show_in_nav ? 'Yes' : 'No' }}</td><td>{{ p.updated_at | date: 'short' }}</td>
          <td><button class="btn sm danger" (click)="remove(p)">Delete</button></td></tr>
      }
    </table></div>`,
})
export class PagesListPage implements OnInit {
  list = signal<any[]>([]); title = '';
  private api = inject(Api); private router = inject(Router); private toast = inject(Toast);
  ngOnInit() { this.load(); }
  async load() { this.list.set((await this.api.get('/api/admin/pages', { size: 100 })).items); }
  async create() {
    if (!this.title.trim()) return;
    try { const r = await this.api.post('/api/admin/pages', { title: this.title, sections: [] }); this.router.navigate(['/admin/pages', r.id]); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
  async remove(p: any) { if (confirm(`Delete page ${p.title}?`)) { await this.api.delete(`/api/admin/pages/${p.id}`); this.load(); } }
}

@Component({
  selector: 'sa-page-editor',
  imports: [RouterLink, FormsModule, SectionEditorComponent, BadgeComponent],
  template: `
    @if (p(); as p) {
      <div class="page-head"><a routerLink="/admin/pages" class="btn sm">‹ Pages</a><h1>{{ p.title }}</h1><ms-badge [value]="p.status" /><span class="spacer"></span>
        <a class="btn" [href]="'/page/' + p.slug" target="_blank">View</a>
        <button class="btn" (click)="save()">Save draft</button><button class="btn primary" (click)="publish()">Publish</button></div>
      <div class="grid c2" style="grid-template-columns: 2fr 1fr; align-items: start">
        <div class="card"><h3>Sections</h3><section-editor [(sections)]="sections" [forms]="forms()" /></div>
        <div class="card stack">
          <label class="field"><span>Title</span><input [(ngModel)]="p.title" /></label>
          <label class="field"><span>URL slug</span><input [(ngModel)]="p.slug" /></label>
          <label class="check"><input type="checkbox" [(ngModel)]="p.show_in_nav" /> Show in store menu</label>
          <label class="field"><span>Menu order</span><input type="number" [(ngModel)]="p.nav_order" /></label>
          <label class="field"><span>SEO title</span><input [(ngModel)]="p.seo_title" /></label>
          <label class="field"><span>SEO description</span><textarea [(ngModel)]="p.seo_description"></textarea></label>
          @if (p.status === 'PUBLISHED') { <button class="btn" (click)="unpublish()">Unpublish</button> }
        </div>
      </div>
    }`,
})
export class PageEditorPage implements OnInit {
  id = input.required<string>();
  p = signal<any>(null); forms = signal<any[]>([]); sections: Section[] = [];
  private api = inject(Api); private toast = inject(Toast);
  async ngOnInit() {
    const p = await this.api.get(`/api/admin/pages/${this.id()}`);
    this.p.set(p); this.sections = structuredClone(p.sections);
    this.forms.set((await this.api.get('/api/admin/forms', { size: 100 })).items);
  }
  async save() {
    const p = this.p();
    try {
      await this.api.put(`/api/admin/pages/${this.id()}`, { title: p.title, slug: p.slug, sections: this.sections, showInNav: !!p.show_in_nav,
        navOrder: Number(p.nav_order || 0), seoTitle: p.seo_title || null, seoDescription: p.seo_description || null });
      this.toast.ok('Saved');
    } catch (e) { this.toast.err(errMsg(e)); }
  }
  async publish() { await this.save(); await this.api.post(`/api/admin/pages/${this.id()}/publish`); this.p.update((p) => ({ ...p, status: 'PUBLISHED' })); this.toast.ok('Published'); }
  async unpublish() { await this.api.post(`/api/admin/pages/${this.id()}/unpublish`); this.p.update((p) => ({ ...p, status: 'DRAFT' })); }
}

// ------------------------------------------------------------------ FORMS (form builder, PDF §9)
@Component({
  selector: 'sa-forms',
  imports: [FormsModule, DatePipe, KeyValuePipe, PagerComponent],
  template: `
    <div class="page-head"><h1>Forms</h1><span class="spacer"></span><button class="btn primary" (click)="edit(null)">New form</button></div>
    <div class="grid c2" style="align-items:start">
      <div class="card" style="padding:0"><table class="table">
        <tr><th>Name</th><th>Fields</th><th>Notify</th><th></th></tr>
        @for (f of list(); track f.id) {
          <tr><td>{{ f.name }}</td><td>{{ f.fields.length }}</td><td>{{ f.notify_email }}</td>
            <td><button class="btn sm" (click)="edit(f)">Edit</button> <button class="btn sm" (click)="subs(f)">Submissions</button></td></tr>
        }
      </table></div>
      @if (f) {
        <form class="card stack" (ngSubmit)="save()">
          <label class="field"><span>Form name</span><input [(ngModel)]="f.name" name="n" required /></label>
          <label class="field"><span>Email submissions to</span><input [(ngModel)]="f.notifyEmail" name="e" type="email" /></label>
          <label class="field"><span>Success message</span><input [(ngModel)]="f.successMessage" name="m" /></label>
          <h3>Fields</h3>
          @for (fl of f.fields; track $index; let i = $index) {
            <div class="row">
              <input [(ngModel)]="fl.label" [name]="'l' + i" placeholder="Label" style="flex:2" (change)="fl.key = fl.key || keyOf(fl.label)" />
              <select [(ngModel)]="fl.type" [name]="'t' + i" style="flex:1">@for (t of fieldTypes; track t) { <option>{{ t }}</option> }</select>
              <label class="check"><input type="checkbox" [(ngModel)]="fl.required" [name]="'r' + i" /> req</label>
              <button type="button" class="btn sm danger" (click)="f.fields.splice(i, 1)">✕</button>
            </div>
            @if (fl.type === 'select') { <input [ngModel]="(fl.options || []).join(', ')" (ngModelChange)="fl.options = $event.split(',').map(trim)" [name]="'o' + i" placeholder="Options, comma separated" /> }
          }
          <button type="button" class="btn sm" (click)="f.fields.push({ key: '', label: '', type: 'text', required: false })">+ Field</button>
          <div class="row"><button class="btn primary">Save form</button><button type="button" class="btn" (click)="f = null">Cancel</button></div>
        </form>
      }
      @if (sub(); as s) {
        <div class="card"><h3>Submissions</h3>
          @for (x of s.items; track x.id) { <div class="drag-item" style="display:block"><small class="muted">{{ x.created_at | date: 'medium' }}</small>
            @for (kv of x.data | keyvalue; track kv.key) { <div><b>{{ kv.key }}:</b> {{ kv.value }}</div> }</div> } @empty { <p class="muted">None yet.</p> }
          <ms-pager [page]="s.page" [totalPages]="s.totalPages" [total]="s.total" (go)="loadSubs($event)" />
        </div>
      }
    </div>`,
})
export class FormsPage implements OnInit {
  list = signal<any[]>([]); sub = signal<OffsetPage<any> | null>(null); f: any = null; subFormId = 0;
  fieldTypes = ['text', 'email', 'tel', 'number', 'textarea', 'select', 'checkbox', 'date'];
  trim = (s: string) => s.trim();
  private api = inject(Api); private toast = inject(Toast);
  ngOnInit() { this.load(); }
  async load() { this.list.set((await this.api.get('/api/admin/forms', { size: 100 })).items); }
  keyOf(label: string) { return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f$1').slice(0, 40) || 'field'; }
  edit(x: any) {
    this.sub.set(null);
    this.f = x ? { id: x.id, name: x.name, notifyEmail: x.notify_email, successMessage: x.success_message, fields: structuredClone(x.fields) }
      : { name: '', notifyEmail: '', successMessage: 'Thank you! We will contact you soon.', fields: [{ key: 'name', label: 'Name', type: 'text', required: true }] };
  }
  async save() {
    const { id, ...b } = this.f;
    b.fields = b.fields.map((fl: any) => ({ ...fl, key: fl.key || this.keyOf(fl.label) }));
    b.notifyEmail = b.notifyEmail || null;
    try { if (id) await this.api.put(`/api/admin/forms/${id}`, b); else await this.api.post('/api/admin/forms', b); this.f = null; this.load(); this.toast.ok('Saved'); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
  subs(x: any) { this.f = null; this.subFormId = x.id; this.loadSubs(1); }
  async loadSubs(page: number) { this.sub.set(await this.api.get(`/api/admin/forms/${this.subFormId}/submissions`, { page })); }
}

// ------------------------------------------------------------------ BLOG add-on
@Component({
  selector: 'sa-blog',
  imports: [FormsModule, DatePipe, BadgeComponent, PagerComponent],
  template: `
    <div class="page-head"><h1>Blog</h1><span class="spacer"></span><button class="btn primary" (click)="edit({})">New post</button></div>
    @if (f) {
      <form class="card stack" (ngSubmit)="save()">
        <label class="field"><span>Title</span><input [(ngModel)]="f.title" name="t" required /></label>
        <label class="field"><span>Excerpt</span><input [(ngModel)]="f.excerpt" name="e" /></label>
        <label class="field"><span>Cover image URL</span><input [(ngModel)]="f.coverImageUrl" name="c" /></label>
        <label class="btn sm"><span class="mi">upload</span> Upload cover<input type="file" accept="image/*" hidden (change)="upload($event)" /></label>
        <label class="field"><span>Content (HTML)</span><textarea rows="14" [(ngModel)]="f.content" name="b" required></textarea></label>
        <label class="field"><span>Status</span><select [(ngModel)]="f.status" name="s"><option>DRAFT</option><option>PUBLISHED</option></select></label>
        <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" (click)="f = null">Cancel</button></div>
      </form>
    } @else {
      <div class="card" style="padding:0"><table class="table">
        <tr><th>Title</th><th>Status</th><th>Published</th><th></th></tr>
        @for (p of page()?.items; track p.id) { <tr><td>{{ p.title }}</td><td><ms-badge [value]="p.status" /></td><td>{{ p.published_at | date: 'mediumDate' }}</td>
          <td><button class="btn sm" (click)="open(p.id)">Edit</button> <button class="btn sm danger" (click)="remove(p.id)">Delete</button></td></tr> }
      </table></div>
      <ms-pager [page]="page()?.page ?? 1" [totalPages]="page()?.totalPages ?? 1" [total]="page()?.total ?? 0" (go)="load($event)" />
    }`,
})
export class BlogAdminPage implements OnInit {
  page = signal<OffsetPage<any> | null>(null); f: any = null;
  private api = inject(Api); private toast = inject(Toast);
  ngOnInit() { this.load(1); }
  async load(p: number) { this.page.set(await this.api.get('/api/admin/blog', { page: p })); }
  edit(p: any) { this.f = { id: p.id, title: p.title ?? '', excerpt: p.excerpt ?? '', coverImageUrl: p.cover_image_url ?? '', content: p.content ?? '', status: p.status ?? 'DRAFT' }; }
  async open(id: number) { this.edit(await this.api.get(`/api/admin/blog/${id}`)); }
  async upload(ev: Event) { const file = (ev.target as HTMLInputElement).files?.[0]; if (file) this.f.coverImageUrl = (await this.api.upload('/api/admin/media', file)).url; }
  async save() {
    const { id, ...b } = this.f;
    b.coverImageUrl = b.coverImageUrl || null;
    try { if (id) await this.api.put(`/api/admin/blog/${id}`, b); else await this.api.post('/api/admin/blog', b); this.f = null; this.load(1); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
  async remove(id: number) { if (confirm('Delete post?')) { await this.api.delete(`/api/admin/blog/${id}`); this.load(1); } }
}

// ------------------------------------------------------------------ BOOKING add-on
@Component({
  selector: 'sa-bookings',
  imports: [FormsModule, DatePipe, BadgeComponent, InrPipe, PagerComponent],
  template: `
    <div class="page-head"><h1>Bookings</h1></div>
    <div class="grid c2" style="grid-template-columns: 2fr 1fr; align-items:start">
      <div>
        <div class="filters"><input type="date" [(ngModel)]="date" (change)="load(1)" /><select [(ngModel)]="status" (change)="load(1)"><option value="">All</option><option>PENDING</option><option>CONFIRMED</option><option>COMPLETED</option><option>CANCELLED</option></select></div>
        <div class="card" style="padding:0"><table class="table">
          <tr><th>When</th><th>Service</th><th>Customer</th><th>Status</th><th></th></tr>
          @for (b of page()?.items; track b.id) {
            <tr><td>{{ b.booking_date | date: 'mediumDate' }} {{ b.start_time.slice(0, 5) }}</td><td>{{ b.service_name }}</td><td>{{ b.customer_name }}<br /><small>{{ b.customer_mobile }}</small></td>
              <td><ms-badge [value]="b.status" /></td>
              <td><select (change)="setStatus(b, $any($event.target).value)"><option value="">Change…</option><option>CONFIRMED</option><option>COMPLETED</option><option>CANCELLED</option></select></td></tr>
          } @empty { <tr><td colspan="5" class="muted">No bookings.</td></tr> }
        </table></div>
        <ms-pager [page]="page()?.page ?? 1" [totalPages]="page()?.totalPages ?? 1" [total]="page()?.total ?? 0" (go)="load($event)" />
      </div>
      <div class="card stack">
        <h3>Services</h3>
        @for (s of services(); track s.id) { <div class="row between"><span>{{ s.name }} · {{ s.duration_minutes }}m · {{ s.price | inr }}</span><button class="btn sm danger" (click)="delSvc(s.id)">✕</button></div> }
        <input [(ngModel)]="svc.name" placeholder="Service name" />
        <div class="grid c3"><input type="number" [(ngModel)]="svc.durationMinutes" placeholder="Minutes" /><input type="number" [(ngModel)]="svc.price" placeholder="Price" />
          <input type="number" [(ngModel)]="svc.slotsPerTime" placeholder="Slots" /></div>
        <button class="btn primary" (click)="addSvc()">Add service</button>
      </div>
    </div>`,
})
export class BookingsAdminPage implements OnInit {
  page = signal<OffsetPage<any> | null>(null); services = signal<any[]>([]);
  date = ''; status = ''; svc: any = { name: '', durationMinutes: 30, price: 0, slotsPerTime: 1 };
  private api = inject(Api); private toast = inject(Toast);
  ngOnInit() { this.load(1); this.loadSvc(); }
  async load(p: number) { this.page.set(await this.api.get('/api/admin/bookings', { page: p, date: this.date, status: this.status })); }
  async loadSvc() { this.services.set((await this.api.get('/api/admin/booking-services', { size: 100 })).items); }
  async setStatus(b: any, s: string) { if (s) { await this.api.put(`/api/admin/bookings/${b.id}/status`, { status: s }); this.load(this.page()!.page); } }
  async addSvc() {
    try { await this.api.post('/api/admin/booking-services', { ...this.svc, durationMinutes: Number(this.svc.durationMinutes), price: Number(this.svc.price), slotsPerTime: Number(this.svc.slotsPerTime) });
      this.svc = { name: '', durationMinutes: 30, price: 0, slotsPerTime: 1 }; this.loadSvc(); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
  async delSvc(id: number) { await this.api.delete(`/api/admin/booking-services/${id}`); this.loadSvc(); }
}
export { JsonPipe };
