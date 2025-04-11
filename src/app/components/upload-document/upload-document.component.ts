import { Component, EventEmitter, OnDestroy, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PDFDocument } from 'pdf-lib';
import { FileSelectEvent, FileUploadModule } from 'primeng/fileupload';
import { PanelModule } from 'primeng/panel';
import { ProgressBarModule } from 'primeng/progressbar';
import { Subscription, timer } from 'rxjs';
import { DocumentForm } from '../../model/documentForm';

@Component({
  standalone: true,
  selector: 'app-upload-document',
  imports: [CommonModule, FileUploadModule, PanelModule, ProgressBarModule],
  templateUrl: './upload-document.component.html',
  styleUrl: './upload-document.component.css',
})
export class UploadDocumentComponent implements OnDestroy {
  // define the variables
  progress: number = 0;
  fileName: string = '';
  fileSize: string = '';
  pageCount: number = 0;
  bokKeywordsRDFstring?: string = '';
  showProgressBar: boolean = false;

  pdfDoc: PDFDocument | null = null;
  private bokRelations: string[] = [];

  private timerSubscription: Subscription | null = null;

  @Output() pdfDocumentChange = new EventEmitter<PDFDocument>();
  @Output() documentDataChange = new EventEmitter<DocumentForm>();
  @Output() conceptsChange = new EventEmitter<string[]>();


  ngOnDestroy(): void {
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
    }
  }

  // triggers when file is loaded
  async onFileSelected(input: FileSelectEvent) {
    if (input.files && input.files.length > 0) {
      this.onClear();
      const file = input.files[0];
      if (file.type != 'application/pdf') return;
      this.fileName = file.name.slice(0, -4);
      this.fileSize = (file.size / (1024 * 1024)).toFixed(2) + ' MB'; // store size in mb
      this.showProgressBar = true;
      this.progress = 0; // Reset progress

      // create a reader object
      const reader = new FileReader();

      // calculate the progress during file upload
      reader.onprogress = (event) => {
        if (event.lengthComputable) {
          this.progress = Math.round((event.loaded / event.total) * 100);
        }
      };

      reader.onloadend = async () => {
        this.progress = 100; // Complete progress

        const arrayBuffer = reader.result as ArrayBuffer;
        this.pdfDoc = await PDFDocument.load(arrayBuffer)
        this.pageCount = this.pdfDoc.getPageCount();

        // subject key stores our RDF formatted string holding BoK relations and description together
        this.bokKeywordsRDFstring = this.pdfDoc.getSubject() || '';
        this.getBoKRelationsArray(this.bokKeywordsRDFstring);

        this.timerSubscription = timer(1500).subscribe(() => {
          this.showProgressBar = false;
          this.pdfDocumentChange.emit(this.pdfDoc!)
          this.documentDataChange.emit(new DocumentForm(this.fileName))
          this.conceptsChange.emit(this.bokRelations);
        });
      };

      // start reading the file
      reader.readAsArrayBuffer(file);
    }
  }

  // function extracts the description and BoK relations
  getBoKRelationsArray(subject: string) {
    if (subject.length != 0 && typeof subject === 'string') {
      this.bokRelations = [...subject.matchAll(/eo4geo:([\w\d-]+)/g)].map(
        (match) => match[1]
      );
    }
  }

  // clears the inputs fields and progress bar
  onClear() {
    this.pdfDoc = null;
    this.showProgressBar = false;
    this.progress = 0;
    this.fileName = '';
    this.fileSize = '';
    this.pageCount = 0;
    this.bokKeywordsRDFstring = '';
    this.bokRelations = [];
    this.pdfDocumentChange.emit(this.pdfDoc!)
    this.documentDataChange.emit(new DocumentForm())
    this.conceptsChange.emit(this.bokRelations);
  }
}
