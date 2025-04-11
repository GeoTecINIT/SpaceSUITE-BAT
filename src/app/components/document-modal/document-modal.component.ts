import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ChipModule } from 'primeng/chip';
import { DividerModule } from 'primeng/divider';
import { BokInformationService } from '@eo4geo/ngx-bok-visualization';
import { map, of, take } from 'rxjs';

@Component({
  standalone: true,
  selector: 'document-modal',
  templateUrl: './document-modal.component.html',
  styleUrls: ['./document-modal.component.css'],
  imports: [ CommonModule, DialogModule, ChipModule, DividerModule ],
})
export class DocumentModalComponent {
  @Input() visible: boolean = false;
  @Output() visibleChange: EventEmitter<boolean> = new EventEmitter(false);
  @Input() name: string = '';
  @Input() description: string = '';
  @Input() concepts: string[] = []

  constructor(private bokInfoService: BokInformationService) {}

  getBackgroundColor(concept: string) {
    const regex = /\[(.*?)\]/;
    const match = concept.match(regex);
    if (match) {
      return this.bokInfoService.getConceptColor(match[1]).pipe(
            take(1),
            map((hex) => this.hexToRgba(hex, 0.5))
          );
    }
    return of('');
  }

  // makes the BoK tags light adding opacity
  private hexToRgba(hex: string, alpha: number): string {
    // Remove the hash if it exists
    hex = hex.replace(/^#/, '');

    // Parse r, g, b values
    let r: number, g: number, b: number;
    if (hex.length === 3) {
      // Convert shorthand hex (e.g., #abc to #aabbcc)
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    }

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
