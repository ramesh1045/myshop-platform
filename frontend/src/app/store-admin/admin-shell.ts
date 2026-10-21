import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AdminSession } from './admin-session';
import { hostUrl } from '../shared/app-mode';
import { BadgeComponent } from '../shared/ui';

/** Sidebar is built ONLY from GET /api/me/menus -> each user sees just the menus they are permitted (PDF §5.2) */
@Component({
  selector: 'admin-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, DatePipe, BadgeComponent],
  template: `
  <div class="shell">
    <aside>
      <div class="brand"><span class="mi">storefront</span> {{ s.store()?.name }}</div>
      @for (m of s.menus(); track m.id) {
        @if (m.children.length) {
          <div class="group">{{ m.label }}</div>
          @for (c of m.children; track c.id) {
            <a [routerLink]="c.route" routerLinkActive="active"><span class="mi">{{ c.icon }}</span>{{ c.label }}</a>
          }
        } @else {
          <a [routerLink]="m.route" routerLinkActive="active"><span class="mi">{{ m.icon }}</span>{{ m.label }}</a>
        }
      }
    </aside>
    <main>
      @if (s.me()?.impersonatedBy) {
        <div class="alert warn mb">You are viewing this store as Super Admin (support mode). All actions are audited.</div>
      }
      @switch (s.store()?.status) {
        @case ('TRIAL') { <div class="alert mb">Free trial ends {{ s.store()?.trialEndsAt | date: 'mediumDate' }}. @if (s.can('BILLING_MANAGE')) { <a routerLink="/admin/billing">Choose a plan</a> }</div> }
        @case ('PAST_DUE') { <div class="alert warn mb">Payment is due. Please pay the open invoice to avoid suspension. @if (s.can('BILLING_MANAGE')) { <a routerLink="/admin/billing">Pay now</a> }</div> }
        @case ('SUSPENDED') { <div class="alert err mb">Your store is suspended — customers cannot place orders. @if (s.can('BILLING_MANAGE')) { <a routerLink="/admin/billing">Pay pending invoice</a> }</div> }
        @case ('PENDING_PAYMENT') { <div class="alert err mb">Complete your first payment to go live. <a routerLink="/admin/billing">Pay now</a></div> }
      }
      <div class="topbar no-print">
        <span class="muted">{{ s.store()?.plan?.name }} plan</span> <ms-badge [value]="s.store()?.status || ''" />
        <span class="spacer"></span>
        <a class="btn sm" [href]="storeUrl()" target="_blank" rel="noopener"><span class="mi">open_in_new</span> View store</a>
        <a class="btn sm" routerLink="/admin/account"><span class="mi">person</span> {{ s.me()?.user?.name }}</a>
        <button class="btn sm" (click)="logout()">Logout</button>
      </div>
      <router-outlet />
    </main>
  </div>`,
})
export class AdminShell {
  s = inject(AdminSession);
  private router = inject(Router);
  storeUrl = computed(() => hostUrl(location.hostname, '/'));
  async logout() { await this.s.logout(); this.router.navigateByUrl('/admin/login'); }
}
