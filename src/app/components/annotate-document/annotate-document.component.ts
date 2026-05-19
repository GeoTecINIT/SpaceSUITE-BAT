import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BokInformationService } from '@eo4geo/ngx-bok-visualization';
import { map, Observable, Subscription, take } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { ChipModule } from 'primeng/chip';

@Component({
  standalone: true,
  selector: 'app-annotate-document',
  imports: [CommonModule, ButtonModule, ChipModule],
  templateUrl: './annotate-document.component.html',
  styleUrl: './annotate-document.component.css',
})
export class AnnotateDocumentComponent {
  @Input() concept: string = 'GIST';
  @Input() isPdfAvailable: boolean = false;
  @Input() bokConcepts: string[] = [];
  @Output() bokConceptsChange: EventEmitter<string[]> = new EventEmitter();
  message: string = '';

  constructor(private bokInfoService: BokInformationService) {}

  onClear() {
    this.bokConceptsChange.emit([]);
  }

  deleteBokConcept(concept: string) {
    this.bokConceptsChange.emit(this.bokConcepts.filter((item) => item !== concept));
  }

  addAnnotation() {
    if (this.bokConcepts.includes(this.concept)) {
      this.message = 'Concept already included!';

      setTimeout(() => (this.message = ''), 3000);
    } else {
      this.bokConceptsChange.emit([...this.bokConcepts, this.concept]);
    }
  }

  getBackgroundColor(concept: string): Observable<string> {
    return this.bokInfoService.getConceptColor(concept).pipe(
      take(1),
      map((hex) => this.hexToRgba(hex, 0.5))
    );
  }

  // fetches the BoK keyword title
  getConceptName(concept: string) {
    return this.bokInfoService.getConceptName(concept).pipe(
      take(1),
      map((name) => name)
    );
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
