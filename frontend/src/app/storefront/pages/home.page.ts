import { Component, inject, OnInit } from '@angular/core';
import { StorefrontService } from '../storefront.service';
import { SectionsComponent } from '../components';

/** Home = the client's ordered section blocks (PDF §5.4 layer 3) */
@Component({
  selector: 'sf-home',
  imports: [SectionsComponent],
  template: `<sf-sections [sections]="sf.config()!.theme.sections" />`,
})
export class HomePage implements OnInit {
  sf = inject(StorefrontService);
  ngOnInit() { this.sf.setSeo(); }
}
