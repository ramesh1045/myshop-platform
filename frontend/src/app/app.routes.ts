import { Routes } from '@angular/router';
import { modeGuard } from './shared/app-mode';

/**
 * One build, four surfaces (PDF §6 "Angular apps (one build: Storefront, Store Admin, Super Admin)").
 * canMatch picks the surface from the hostname; each surface is lazy-loaded.
 */
export const routes: Routes = [
  { path: '', canMatch: [modeGuard('marketing')], loadChildren: () => import('./marketing/marketing.routes').then((m) => m.MARKETING_ROUTES) },
  { path: '', canMatch: [modeGuard('superadmin')], loadChildren: () => import('./super-admin/super-admin.routes').then((m) => m.SUPER_ADMIN_ROUTES) },
  { path: 'admin', canMatch: [modeGuard('store')], loadChildren: () => import('./store-admin/store-admin.routes').then((m) => m.STORE_ADMIN_ROUTES) },
  { path: '', canMatch: [modeGuard('store')], loadChildren: () => import('./storefront/storefront.routes').then((m) => m.STOREFRONT_ROUTES) },
];
