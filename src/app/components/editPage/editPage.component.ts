import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { BokComponent } from '@eo4geo/ngx-bok-visualization';
import { AnnotateDocumentComponent } from '../annotate-document/annotate-document.component';
import { PDFDocument } from 'pdf-lib';
import { CommonModule } from '@angular/common';
import { catchError, concatMap, finalize, of, Subscription, take, tap } from 'rxjs';
import { AccordionModule } from 'primeng/accordion';
import { ButtonModule } from 'primeng/button';
import { DividerModule } from 'primeng/divider';
import { DocumentInformationComponent } from "../document-information/document-information.component";
import { DocumentForm } from '../../model/documentForm';
import { ToastModule } from 'primeng/toast';
import { MessageService } from "primeng/api";
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Auth, authState } from '@angular/fire/auth';
import { StorageService } from '../../services/storage.service';
import { AnnotatedDocument } from '../../model/annotatedDocument';

@Component({
  standalone: true,
  selector: 'edit-page',
  templateUrl: './editPage.component.html',
  styleUrls: ['./editPage.component.css'],
  imports: [
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
export class EditPageComponent implements OnInit, OnDestroy {
  concept: string = 'GIST'
  logged: boolean = false;
  pdfDoc: PDFDocument | null = null;
  formContent: DocumentForm = new DocumentForm();
  bokRelations: string[] = [];

  loading: boolean = false;

  private auth;
  private loggedSubscrition!: Subscription;
  private annotatedDocument: AnnotatedDocument = new AnnotatedDocument('','','','', '', '', '', false, '', '', '', [], 3, null, null, '');

  constructor(private storageService: StorageService, private messageService: MessageService, private router: Router, private route: ActivatedRoute, private http: HttpClient) {
    this.auth = inject(Auth);
    this.loggedSubscrition = authState(this.auth).subscribe(user => {
        this.logged = !!user;
    });
  }

  ngOnInit(): void {
    const documentId = this.route.snapshot.paramMap.get('id') as string;
    this.storageService.getDocument(documentId).pipe(
      take(1),
      concatMap(document => {
        this.annotatedDocument = document;
        this.bokRelations = this.formatFirestoreConcepts(document.concepts);
        this.formContent = {
          name: document.name,
          description: document.description,
          publicFile: document.isPublic,
          organization: {_id: document.orgId, name: document.orgName},
          division: document.division
        };
        return this.http.get(document.url, { responseType: 'blob' })
      }),
      concatMap( blob => blob.arrayBuffer()),
      concatMap( file => PDFDocument.load(file)),
      tap( file => this.pdfDoc = file )
    ).subscribe();
  }

  ngOnDestroy() {
    this.loggedSubscrition.unsubscribe();
  }

  private formatFirestoreConcepts(concepts: string[]){
    const regex = /\[(.*?)\]/;
    return concepts.map(concept => concept.match(regex)?.[1])
    .filter(Boolean) as string[];
  }

  async onDownload() {
    // check if file is available; if available, download, otherwise, set error message telling no file available to downlaod!
    if (this.pdfDoc) {
      // function returns the configured string in RDF format
      const relationsMetadata = this.configureMetaData(this.bokRelations);
      this.pdfDoc?.setTitle(this.formContent?.name + '_annotated');

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
    if (this.pdfDoc && this.formContent) {
      const relationsMetadata = this.configureMetaData(this.bokRelations);
      this.pdfDoc?.setTitle(this.formContent?.name + '_annotated');
      this.pdfDoc?.setSubject(relationsMetadata);
      let isSuccess = true;
      this.loading = true;
      this.storageService.updateDocument(this.pdfDoc, this.formContent, this.bokRelations, this.annotatedDocument).pipe(
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
}
