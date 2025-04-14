import { inject, Injectable } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import { collection, collectionData, CollectionReference, deleteDoc, doc, docData, FieldValue, Firestore, query, serverTimestamp, setDoc, where } from '@angular/fire/firestore';
import { deleteObject, getDownloadURL, ref, Storage, uploadBytes } from '@angular/fire/storage';
import { catchError, concatMap, forkJoin, from, map, Observable, of, take, throwError } from 'rxjs';
import { AnnotatedDocument } from '../model/annotatedDocument';
import { PDFDocument } from 'pdf-lib';
import { DocumentForm } from '../model/documentForm';
import { BokInformationService } from '@eo4geo/ngx-bok-visualization';

@Injectable({
  providedIn: 'root',
})
export class StorageService {

  private auth;
  private db;
  private storage;

  private docsCollection: CollectionReference;

  private userId: string = '';

  constructor(private bokInfoService: BokInformationService) { 
    this.auth = inject(Auth);
    this.db = inject(Firestore);
    this.storage = inject(Storage)

    this.docsCollection = collection(this.db, 'Other');

    authState(this.auth).subscribe(user => this.userId = user?.uid ?? '');
  }

  saveDocument(file: PDFDocument, data: DocumentForm, concepts: string[]): Observable<void> {
    if (this.userId == '') return throwError(() => new Error('Login to save a file'));
    return this.preparePdfBlob(file).pipe(
      concatMap(blob => this.uploadPdf(blob, data.name)),
      concatMap(downloadUrl => this.saveDocumentMetadata(downloadUrl, data, concepts)),
      catchError( () => throwError(
        () => new Error('Something went wrong. Try to upload this file later.')
      ))
    );
  }

  updateDocument(file: PDFDocument, data: DocumentForm, concepts: string[], oldDoc: AnnotatedDocument): Observable<void> {
    if (this.userId == '') return throwError(() => new Error('Login to save a file'));
    const documentPath = this.extractFirebasePath(oldDoc.url) ?? undefined;
    return this.preparePdfBlob(file).pipe(
      concatMap(blob => this.uploadPdf(blob, data.name, documentPath)),
      concatMap(downloadUrl => this.saveDocumentMetadata(downloadUrl, data, concepts, oldDoc._id, oldDoc.createdAt)),
      catchError( () => throwError(
        () => new Error('Something went wrong. Try to upload this file later.')
      ))
    );
  }

  private preparePdfBlob(file: PDFDocument): Observable<Blob> {
    return from(file.save()).pipe(
      map(pdfBytes => new Blob([pdfBytes], { type: 'application/pdf' }))
    );
  }

  private uploadPdf(blob: Blob, fileName: string, docPath?: string): Observable<string> {
    const path = docPath ?? `other/custom-${fileName}-${this.userId}-${Date.now()}`;
    const storageRef = ref(this.storage, path);
    return from(uploadBytes(storageRef, blob)).pipe(
      concatMap(() => getDownloadURL(storageRef))
    );
  }

  private saveDocumentMetadata(downloadUrl: string, data: DocumentForm, concepts: string[], docId?: string, originalDate?: FieldValue): Observable<void> {
    const conceptObservables = concepts.length > 0 ? forkJoin(concepts.map(concept =>
      this.bokInfoService.getConceptName(concept).pipe(
        take(1),
        map(conceptName => `[${concept}] ${conceptName}`)
      )
    ))
    : of([]);
    return conceptObservables.pipe(
      concatMap(formatedConcepts => {
        const timestamp = serverTimestamp();
        const orgRef = docId ? doc(this.docsCollection, docId) : doc(this.docsCollection);
        const newDocument: AnnotatedDocument = new AnnotatedDocument(orgRef.id, downloadUrl, this.userId, data.organization._id, data.organization.name, 'Other', 'Other', data.publicFile, data.name, data.name, data.description, formatedConcepts, 3, timestamp, originalDate ?? timestamp, data.division);
        return from(setDoc(orgRef, newDocument.toPlainObject()));
      })
    );
  }

  getAnnotatedDocuments(): Observable<AnnotatedDocument[]> {
    return authState(this.auth).pipe(
      concatMap(user => {
        if (user) {
          const selfDocsQuery = query(this.docsCollection, where('userId', '==', user.uid));
          return collectionData(selfDocsQuery) as Observable<AnnotatedDocument[]>;
        }
        return of([]);
      })
    );
  }

  deleteDocument(document: AnnotatedDocument) {
    const docReference = doc(this.docsCollection, document._id)
    const path = this.extractFirebasePath(document.url);
    return from(deleteDoc(docReference)).pipe(
      concatMap( () => {
        if (path) {
          const fileRef = ref(this.storage, path);
          return deleteObject(fileRef)
        }
        return of()
      }),
      catchError( () => throwError(
        () => new Error('Something went wrong. Try to delete this file later or contact the administrator.')
      ))
    );
  }

  private extractFirebasePath(url: string): string | null {
    try {
      const match = url.match(/\/o\/(.+?)\?/);
      if (!match || match.length < 2) return null;
  
      // decode twice in case of double encoding (like %2520 = %20 = space)
      let path = decodeURIComponent(match[1]);
      path = decodeURIComponent(path);
  
      return path;
    } catch (error) {
      return null;
    }
  }

  getDocument(id: string): Observable<AnnotatedDocument> {
    const docReference = doc(this.docsCollection, id)
    return docData(docReference) as Observable<AnnotatedDocument>
  }

}