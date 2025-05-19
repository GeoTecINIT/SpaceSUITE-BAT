import {Component, EventEmitter, Input, Output} from '@angular/core';
import { DialogModule } from 'primeng/dialog';

@Component({
  standalone: true,
  selector: 'release-notes',
  templateUrl: './releaseNotes.component.html',
  styleUrls: ['./releaseNotes.component.css'],
  imports: [DialogModule],
})
export class ReleaseNotesComponent {
    @Input() visible: boolean = false;
    @Output() visibleChange: EventEmitter<boolean> = new EventEmitter<boolean>();
}