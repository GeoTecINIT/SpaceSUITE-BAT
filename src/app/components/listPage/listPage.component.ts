import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastModule } from 'primeng/toast';
import { ButtonModule } from "primeng/button";
import { CardModule } from 'primeng/card';
import { FloatLabelModule } from "primeng/floatlabel"
import { InputTextModule } from 'primeng/inputtext';
import { FormsModule } from '@angular/forms';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from "primeng/api";
import { StorageService } from '../../services/storage.service';
import { AnnotatedDocument } from '../../model/annotatedDocument';
import { catchError, finalize, of, Subscription } from 'rxjs';
import { DocumentModalComponent } from "../document-modal/document-modal.component";
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { AuthService } from '@eo4geo/ngx-bok-utils';

@Component({
  standalone: true,
  selector: 'list-page',
  templateUrl: './listPage.component.html',
  styleUrls: ['./listPage.component.css'],
  imports: [CommonModule, ToastModule, ButtonModule, CardModule, ConfirmDialogModule, FloatLabelModule, InputTextModule, FormsModule,
    IconFieldModule, InputIconModule, DocumentModalComponent],
  providers: [MessageService, ConfirmationService]
})
export class ListPageComponent implements OnInit, OnDestroy {
  documents: AnnotatedDocument[] = [];
  searchValue: string = '';

  filteredDocuments: AnnotatedDocument[] = [];

  viewModal: boolean = false;
  modalName: string = '';
  modalDescription: string = '';
  modalConcepts: string[] = [];

  loading = true;

  private documentsSubscription!: Subscription;
  private authSubscription!: Subscription;

  constructor(private storageService: StorageService, private messageService: MessageService, private authService: AuthService,
              private confirmationService: ConfirmationService, private http: HttpClient, private router: Router) {}

  ngOnInit(): void {
    this.authSubscription = this.authService.getUserState().subscribe ( state => {
      if (!state?.logged) this.router.navigate(['']);
    });
    this.documentsSubscription = this.storageService.getAnnotatedDocuments().subscribe(newDocuments => {
      this.documents = newDocuments;
      this.filteredDocuments = this.documents;
      this.loading = false;
    });
  }

  ngOnDestroy() {
    this.documentsSubscription.unsubscribe();
    this.authSubscription.unsubscribe();
  }

  filterList() {
    this.filteredDocuments = this.documents.filter(doc => doc.name.toLowerCase().includes(this.searchValue.toLowerCase()))
  }

  deleteModal(event: Event, document: AnnotatedDocument) {
    this.confirmationService.confirm({
        target: event.target as EventTarget,
        message: 'Do you want to delete this document?',
        header: 'Delete Document',
        icon: 'pi pi-info-circle',
        rejectLabel: 'Cancel',
        rejectButtonProps: {
            label: 'Cancel',
            severity: 'secondary',
        },
        acceptButtonProps: {
            label: 'Delete',
            severity: 'primary',
        },

        accept: () => {
          this.deleteDocument(document);
        },
        reject: () => {
        },
    });
  }

  deleteDocument(document: AnnotatedDocument) {
    let isSuccess = true;
    this.storageService.deleteDocument(document).pipe(
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
        if (isSuccess) {
          this.messageService.add({ 
            severity: 'info', 
            summary: 'Info', 
            detail: `You deleted the document without problems.`,
            life: 3000, 
            closable: true 
          }); 
        }
      })
    ).subscribe();
  }

  showModal(name: string, description: string, concepts: string[]) {
    this.modalConcepts = concepts;
    this.modalName = name;
    this.modalDescription = description;
    this.viewModal = true;
  }

  downloadFile(url: string, name: string) {
    this.http.get(url, { responseType: 'blob' }).subscribe(blob => {
      const file = new Blob([blob], { type: 'application/pdf' });
      const objectUrl = URL.createObjectURL(file);

      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${name}_annotated.pdf`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(objectUrl);
    });
  }

  editDocumentAnnotation(documentId: string) {
    this.router.navigate(['edit/' + documentId])
  }

  isdocumentModified(document: AnnotatedDocument): boolean {
    return document.createdAt.toDate().toLocaleString() != document.updatedAt.toDate().toLocaleString();
  }
}
