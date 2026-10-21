import { Directive, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { StorefrontService } from '../storefront.service';
import { CartService } from '../cart.service';
import { AuthStore } from '../../shared/auth';

/** Shared behaviour for every theme layout (layer 1). Each theme only differs in markup & style. */
@Directive()
export abstract class ThemeBase {
  sf = inject(StorefrontService);
  cart = inject(CartService);
  auth = inject(AuthStore);
  private router = inject(Router);
  menuOpen = signal(false);
  q = '';
  cfg = computed(() => this.sf.config()!);
  s = computed(() => this.sf.settings());
  topCats = computed(() => this.cfg().nav.categories.filter((c) => !c.parent_id));
  isPreview = computed(() => this.cfg().theme.stage === 'DRAFT');
  year = new Date().getFullYear();
  search() {
    if (this.q.trim()) this.router.navigate(['/products'], { queryParams: { q: this.q.trim() } });
    this.menuOpen.set(false);
  }
}

/** Layer-1 theme registry: theme code -> lazy loaded Angular layout component (PDF §5.4).
 *  Exclusive client themes (PDF §9) are added here in the SAME codebase, keyed by their code. */
export const THEME_REGISTRY: Record<string, () => Promise<any>> = {
  classic: () => import('./classic.layout').then((m) => m.ClassicLayout),
  modern: () => import('./modern.layout').then((m) => m.ModernLayout),
  boutique: () => import('./boutique.layout').then((m) => m.BoutiqueLayout),
};
