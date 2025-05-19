import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class PdfService {

  private pdfUrl = '/assets/BAT_User_Guide.pdf';

  constructor(private http: HttpClient) { }

  getPdf(): Observable<Blob> {
    return this.http.get(this.pdfUrl, { responseType: 'blob' });
  }
}
