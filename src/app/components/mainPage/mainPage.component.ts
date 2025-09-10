import { Component, inject } from '@angular/core';
import { UploadDocumentComponent } from '../upload-document/upload-document.component';
import { BokComponent } from '@eo4geo/ngx-bok-visualization';
import { AnnotateDocumentComponent } from '../annotate-document/annotate-document.component';
import { PDFDocument } from 'pdf-lib';
import { CommonModule } from '@angular/common';
import { catchError, finalize, of, Subscription } from 'rxjs';
import { AccordionModule } from 'primeng/accordion';
import { ButtonModule } from 'primeng/button';
import { DividerModule } from 'primeng/divider';
import { DocumentInformationComponent } from "../document-information/document-information.component";
import { DocumentForm } from '../../model/documentForm';
import { ToastModule } from 'primeng/toast';
import { MessageService } from "primeng/api";
import { StorageService } from '../../services/storage.service';
import { Router } from '@angular/router';
import { Auth, authState } from '@angular/fire/auth';

@Component({
  standalone: true,
  selector: 'main-page',
  templateUrl: './mainPage.component.html',
  styleUrls: ['./mainPage.component.css'],
  imports: [
    UploadDocumentComponent,
    AnnotateDocumentComponent,
    BokComponent,
    CommonModule,
    AccordionModule,
    DocumentInformationComponent,
    ButtonModule,
    DividerModule,
    ToastModule
  ],
  providers: [MessageService]
})
export class MainPageComponent {
  concept: string = 'GIST'
  logged: boolean = false;
  pdfDoc: PDFDocument | null = null;
  formContent: DocumentForm = new DocumentForm();
  bokRelations: string[] = [];

  loading: boolean = false;

  private auth;
  private loggedSubscrition!: Subscription;

  constructor(private storageService: StorageService, private messageService: MessageService, private router: Router) {
    this.auth = inject(Auth);
    this.loggedSubscrition = authState(this.auth).subscribe(user => {
        this.logged = !!user;
    });
  }

  ngOnDestroy() {
    this.loggedSubscrition.unsubscribe();
  }

  async onDownload() {
    // check if file is available; if available, download, otherwise, set error message telling no file available to downlaod!
    if (this.pdfDoc) {
      // function returns the configured string in RDF format
      const relationsMetadata = this.configureMetaData(this.bokRelations);
      this.pdfDoc?.setTitle(this.formContent.name + '_annotated');

      // stores the RDF format string holding BoK keys and relations
      this.pdfDoc?.setSubject(relationsMetadata);
      const pdfBytes = await this.pdfDoc.save();

      // set title and download pdf
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.style.display = 'none';
      link.download = this.formContent?.name + '_annotated.pdf';
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    }
  }

  onSave() {
    if (this.pdfDoc && this.checkFormContent()) {
      const relationsMetadata = this.configureMetaData(this.bokRelations);
      this.pdfDoc?.setTitle(this.formContent?.name + '_annotated');
      this.pdfDoc?.setSubject(relationsMetadata);
      let isSuccess = true;
      this.loading = true;
      this.storageService.saveDocument(this.pdfDoc, this.formContent, this.bokRelations).pipe(
        catchError((error) => {
          isSuccess = false;
          this.messageService.add({ 
            severity: 'error', 
            summary: 'Error', 
            detail: error.message ?? 'Something went wrong. Try again later or contact the administrator.', 
            life: 3000, 
            closable: true 
          });
          return of(null);
        }),
        finalize(() => {
          this.loading = false;
          if (isSuccess) {
            this.navigateToMyDocs()
          }
        })
      ).subscribe();
    }
  }

  checkFormContent(): boolean {
    return (this.formContent.name != '' && this.formContent.organization._id != '')
  }

  updateFormContent(data: DocumentForm) {
    this.formContent = data;
  }

  // creates a RDF formatted string for BoK keywords
  configureMetaData(relations: string[]) {
    const bokRelations = relations.map(
      (relation) => 'dc:relation eo4geo:' + relation
    );
    const bokRelationsString = bokRelations.join('; ');
    const rdfPrefix = `@prefix dc: <http://purl.org/dc/terms/> . @prefix eo4geo: <http://bok.eo4geo.eu/> . <> ${bokRelationsString} .`;

    return rdfPrefix;
  }

  navigateToMyDocs() {
    this.router.navigate(['list'])
  }

  onPdfDocChange(newDoc: PDFDocument | null) {
    this.pdfDoc = newDoc;
    if (newDoc) {
      this.messageService.add({ 
        severity: 'info', 
        summary: 'Info', 
        detail: `You uploaded a file without problems.`,
        life: 3000, 
        closable: true 
      }); 
    }
  }
}
