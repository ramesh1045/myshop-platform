import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, JsonPipe } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Api, OffsetPage, errMsg } from '../../shared/api.service';
import { BadgeComponent, PagerComponent, Toast } from '../../shared/ui';
import { AdminSession } from '../admin-session';

// ------------------------------------------------------------------ MENUS (PDF §5.2: rename, hide, drag & drop order)
@Component({
  selector: 'sa-menus',
  imports: [FormsModule, DragDropModule],
  template: `
    <div class="page-head"><h1>Menus</h1><span class="spacer"></span>
      <button class="btn" (click)="reset()">Reset to default</button><button class="btn primary" (click)="save()">Save</button></div>
    <p class="muted">Rename menus, hide the ones you don't use, and drag to change the order. Staff still see only the menus their role allows.</p>
    <div class="card" style="max-width:720px">
      <div cdkDropList (cdkDropListDropped)="drop(top(), $event)">
        @for (m of top(); track m.id) {
          <div class="drag-item" cdkDrag style="flex-direction:column;align-items:stretch">
            <div class="row"><span class="mi drag-handle" cdkDragHandle>drag_indicator</span>
              <span class="mi">{{ m.icon }}</span>
              <input [(ngModel)]="m.customLabel" [placeholder]="m.defaultLabel" style="max-width:260px" />
              <span class="spacer"></span><label class="check"><input type="checkbox" [(ngModel)]="m.isHidden" [disabled]="m.code === 'menus'" /> Hide</label></div>
            @if (children(m.id).length) {
              <div cdkDropList (cdkDropListDropped)="drop(children(m.id), $event)" style="margin:8px 0 0 34px">
                @for (c of children(m.id); track c.id) {
                  <div class="drag-item" cdkDrag><span class="mi drag-handle" cdkDragHandle>drag_indicator</span><span class="mi">{{ c.icon }}</span>
                    <input [(ngModel)]="c.customLabel" [placeholder]="c.defaultLabel" style="max-width:240px" />
                    <span class="spacer"></span><label class="check"><input type="checkbox" [(ngModel)]="c.isHidden" [disabled]="c.code === 'menus'" /> Hide</label></div>
                }
              </div>
            }
          </div>
        }
      </div>
    </div>`,
})
export class MenusPage implements OnInit {
  items = signal<any[]>([]);
  top = computed(() => this.items().filter((m) => !m.parentId).sort((a, b) => a.sortOrder - b.sortOrder));
  private api = inject(Api); private toast = inject(Toast); private s = inject(AdminSession);
  ngOnInit() { this.load(); }
  async load() { this.items.set(await this.api.get('/api/admin/menus')); }
  children(id: number) { return this.items().filter((m) => m.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder); }
  drop(list: any[], e: CdkDragDrop<any>) {
    moveItemInArray(list, e.previousIndex, e.currentIndex);
    list.forEach((m, i) => (m.sortOrder = (list === this.top() ? 10 : 1) * (i + 1)));
    this.items.set([...this.items()]);
  }
  async save() {
    try {
      await this.api.put('/api/admin/menus', { items: this.items().map((m) => ({ id: m.id, customLabel: m.customLabel || null, isHidden: !!m.isHidden, sortOrder: m.sortOrder })) });
      await this.s.reloadMenus(); this.toast.ok('Menus saved');
    } catch (e) { this.toast.err(errMsg(e)); }
  }
  async reset() { if (confirm('Reset all menu names and order?')) { await this.api.post('/api/admin/menus/reset'); await this.load(); await this.s.reloadMenus(); } }
}

// ------------------------------------------------------------------ ROLES (PDF §5.1: client ticks permission checkboxes)
@Component({
  selector: 'sa-roles',
  imports: [FormsModule],
  template: `
    <div class="page-head"><h1>Roles & permissions</h1><span class="spacer"></span><button class="btn primary" (click)="edit(null)">New role</button></div>
    <div class="grid c2" style="grid-template-columns: 1fr 2fr; align-items:start">
      <div class="card" style="padding:0"><table class="table">
        <tr><th>Role</th><th class="num">Users</th><th class="num">Permissions</th></tr>
        @for (r of roles(); track r.id) {
          <tr (click)="edit(r)" style="cursor:pointer" [style.background]="f?.id === r.id ? '#eff6ff' : ''"><td><b>{{ r.name }}</b><br /><small class="muted">{{ r.description }}</small></td>
            <td class="num">{{ r.userCount }}</td><td class="num">{{ r.permissions.length }}</td></tr>
        }
      </table></div>
      @if (f) {
        <div class="card stack">
          <div class="grid c2"><label class="field"><span>Role name</span><input [(ngModel)]="f.name" /></label>
            <label class="field"><span>Description</span><input [(ngModel)]="f.description" /></label></div>
          @for (g of groups(); track g.group) {
            <div><div class="row"><b>{{ g.group }}</b><button class="link" (click)="toggleGroup(g)">toggle all</button></div>
              <div class="grid c3">@for (p of g.permissions; track p.code) {
                <label class="check"><input type="checkbox" [checked]="f.permissions.has(p.code)" (change)="toggle(p.code)" /> {{ p.name }}</label>
              }</div></div>
          }
          <div class="row"><button class="btn primary" (click)="save()">Save role</button>
            @if (f.id) { <button class="btn danger" (click)="remove()">Delete role</button> }</div>
        </div>
      }
    </div>`,
})
export class RolesPage implements OnInit {
  roles = signal<any[]>([]); groups = signal<any[]>([]); f: any = null;
  private api = inject(Api); private toast = inject(Toast);
  async ngOnInit() { this.groups.set(await this.api.get('/api/admin/permissions')); this.load(); }
  async load() { this.roles.set(await this.api.get('/api/admin/roles')); }
  edit(r: any) { this.f = r ? { id: r.id, name: r.name, description: r.description ?? '', permissions: new Set(r.permissions) } : { name: '', description: '', permissions: new Set<string>() }; }
  toggle(code: string) { this.f.permissions.has(code) ? this.f.permissions.delete(code) : this.f.permissions.add(code); }
  toggleGroup(g: any) { const all = g.permissions.every((p: any) => this.f.permissions.has(p.code)); g.permissions.forEach((p: any) => all ? this.f.permissions.delete(p.code) : this.f.permissions.add(p.code)); }
  async save() {
    const body = { name: this.f.name, description: this.f.description || null, permissions: [...this.f.permissions] };
    try { if (this.f.id) await this.api.put(`/api/admin/roles/${this.f.id}`, body); else await this.api.post('/api/admin/roles', body); this.toast.ok('Role saved'); this.f = null; this.load(); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
  async remove() { if (confirm('Delete this role? Users lose its permissions.')) { await this.api.delete(`/api/admin/roles/${this.f.id}`); this.f = null; this.load(); } }
}

// ------------------------------------------------------------------ STAFF (PDF §5.3)
@Component({
  selector: 'sa-staff',
  imports: [FormsModule, DatePipe, BadgeComponent, PagerComponent],
  template: `
    <div class="page-head"><h1>Staff</h1><span class="spacer"></span>@if (s.can('STAFF_MANAGE')) { <button class="btn primary" (click)="invite = { email: '', name: '', roleIds: [] }">Invite staff</button> }</div>
    @if (invite) {
      <div class="card stack mb" style="max-width:640px">
        <div class="grid c2"><label class="field"><span>Name</span><input [(ngModel)]="invite.name" /></label><label class="field"><span>Email</span><input [(ngModel)]="invite.email" type="email" /></label></div>
        <div><b>Roles</b><div class="row">@for (r of roles(); track r.id) { <label class="check"><input type="checkbox" (change)="toggleRole(invite.roleIds, r.id)" /> {{ r.name }}</label> }</div></div>
        <div class="row"><button class="btn primary" (click)="sendInvite()">Send invitation</button><button class="btn" (click)="invite = null">Cancel</button></div>
        @if (link()) { <div class="alert">Invitation emailed. You can also share this link: <br /><code>{{ link() }}</code></div> }
      </div>
    }
    <div class="card" style="padding:0"><table class="table">
      <tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th>Last login</th><th></th></tr>
      @for (u of page()?.items; track u.id) {
        <tr><td>{{ u.name }}@if (u.is_owner) { <span class="badge">Owner</span> }</td><td>{{ u.email }}</td>
          <td>@if (u.is_owner) { All permissions } @else if (editing === u.id) {
              @for (r of roles(); track r.id) { <label class="check"><input type="checkbox" [checked]="sel.includes(r.id)" (change)="toggleRole(sel, r.id)" /> {{ r.name }}</label> }
              <button class="btn sm primary" (click)="saveRoles(u)">Save</button>
            } @else { {{ roleNames(u) }} }</td>
          <td><ms-badge [value]="u.status" /></td><td>{{ u.last_login_at | date: 'short' }}</td>
          <td>@if (!u.is_owner && s.can('STAFF_MANAGE')) {
            <button class="btn sm" (click)="editing = u.id; sel = u.roles.map(idOf)">Roles</button>
            @if (u.status === 'INVITED') { <button class="btn sm" (click)="resend(u)">Resend</button> }
            <button class="btn sm" [class.danger]="u.status !== 'DISABLED'" (click)="toggleStatus(u)">{{ u.status === 'DISABLED' ? 'Enable' : 'Disable' }}</button> }</td></tr>
      }
    </table></div>
    <ms-pager [page]="page()?.page ?? 1" [totalPages]="page()?.totalPages ?? 1" [total]="page()?.total ?? 0" (go)="load($event)" />`,
})
export class StaffPage implements OnInit {
  s = inject(AdminSession); private api = inject(Api); private toast = inject(Toast);
  page = signal<OffsetPage<any> | null>(null); roles = signal<any[]>([]); link = signal('');
  invite: any = null; editing: number | null = null; sel: number[] = [];
  idOf = (r: any) => r.id;
  async ngOnInit() { this.load(1); this.roles.set(await this.api.get('/api/admin/roles')); }
  async load(p: number) { this.page.set(await this.api.get('/api/admin/staff', { page: p })); }
  roleNames(u: any) { return u.roles.map((r: any) => r.name).join(', ') || '—'; }
  toggleRole(list: number[], id: number) { const i = list.indexOf(id); i >= 0 ? list.splice(i, 1) : list.push(id); }
  async sendInvite() {
    try { const r = await this.api.post('/api/admin/staff/invite', this.invite); this.link.set(r.inviteLink); this.toast.ok('Invitation sent'); this.load(1); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
  async resend(u: any) { const r = await this.api.post(`/api/admin/staff/${u.id}/resend-invite`); this.toast.ok('Invitation re-sent'); this.link.set(r.inviteLink); this.invite ??= { email: u.email, name: u.name, roleIds: [] }; }
  async saveRoles(u: any) {
    try { await this.api.put(`/api/admin/staff/${u.id}`, { roleIds: this.sel }); this.editing = null; this.load(this.page()!.page); this.toast.ok('Roles updated'); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
  async toggleStatus(u: any) {
    try { await this.api.put(`/api/admin/staff/${u.id}`, { status: u.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED' }); this.load(this.page()!.page); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
}

// ------------------------------------------------------------------ AUDIT LOG (PDF §12 phase 2 — cursor "load more")
@Component({
  selector: 'sa-audit',
  imports: [DatePipe, JsonPipe, FormsModule],
  template: `
    <div class="page-head"><h1>Audit log</h1></div>
    <div class="filters"><input placeholder="Action e.g. PRODUCT_UPDATE" [(ngModel)]="action" (keyup.enter)="reload()" /></div>
    <div class="card" style="padding:0"><table class="table">
      <tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th></tr>
      @for (a of items(); track a.id) {
        <tr><td>{{ a.created_at | date: 'short' }}</td><td>{{ a.actor_name || a.actor_type }}@if (a.impersonator_id) { <span class="badge">via Super Admin</span> }</td>
          <td><code>{{ a.action }}</code></td><td>{{ a.entity_type }} {{ a.entity_id }}</td>
          <td><details><summary>view</summary><pre style="white-space:pre-wrap;max-width:420px">{{ a.new_values | json }}</pre></details></td></tr>
      }
    </table></div>
    @if (cursor()) { <div class="pager"><button class="btn" (click)="more()">Load more</button></div> }`,
})
export class AuditPage implements OnInit {
  items = signal<any[]>([]); cursor = signal<string | null>(null); action = '';
  private api = inject(Api);
  ngOnInit() { this.more(); }
  reload() { this.items.set([]); this.cursor.set(null); this.more(); }
  async more() {
    const r = await this.api.get('/api/admin/audit', { cursor: this.cursor() ?? undefined, action: this.action || undefined, size: 30 });
    this.items.update((l) => [...l, ...r.items]); this.cursor.set(r.nextCursor);
  }
}
