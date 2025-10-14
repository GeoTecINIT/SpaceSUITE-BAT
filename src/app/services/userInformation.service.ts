import { inject, Injectable } from '@angular/core';
import { collection, collectionData, CollectionReference, doc, docData, Firestore } from '@angular/fire/firestore';
import { AuthService } from '@eo4geo/ngx-bok-utils';
import { concatMap, map, Observable, of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class UserInformationService {

  private db;

  private orgCollection: CollectionReference;

  constructor(private authService: AuthService) { 
    this.db = inject(Firestore);
    this.orgCollection = collection(this.db, 'Organizations');
  }

  getUserOrganizationList(): Observable<{ _id: string, name: string }[]> {
    let uid = ''
    return this.authService.getUserState().pipe(
      concatMap(state => {
        if (!state?.logged) return of([]);
        uid = state.uid;
        return collectionData(this.orgCollection) as Observable<{ _id: string, name: string, regular: string[], admin: string[] }[]>;
      }),
      map(organizations => 
        organizations.filter(organization => organization.regular.includes(uid) || organization.admin.includes(uid))
        .map(organization => ({ _id: organization._id, name: organization.name }))
      )
    );
  }

  getOrganizationDivisions(orgId: string): Observable<string[]> {
    const orgDocRef = doc(this.orgCollection, orgId);
    const organizationUsersSnapshot = docData(orgDocRef) as Observable<{ divisions: string[] }>;
    return organizationUsersSnapshot.pipe(
      map(data => data.divisions)
    );
  }

}