import { ApplicationConfig } from '@angular/core';
import { provideProtractorTestingSupport } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeng/themes/aura';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Routes, withRouterConfig } from '@angular/router';
import { AuthGuard, NotFoundPageComponent, OrganizationPageComponent, UserPageComponent } from '@eo4geo/ngx-bok-utils';
import { environment } from './environments/environment';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { provideStorage, getStorage } from '@angular/fire/storage';
import { MainPageComponent } from './app/components/mainPage/mainPage.component';
import { ListPageComponent } from './app/components/listPage/listPage.component';
import { EditPageComponent } from './app/components/editPage/editPage.component';

const routes: Routes = [
    { path: '', component: MainPageComponent },
    { path: 'list', component: ListPageComponent, canMatch: [AuthGuard]},
    { path: 'edit/:id', component: EditPageComponent, canMatch: [AuthGuard]},
    { path: 'profile', component: UserPageComponent, canMatch: [AuthGuard]},
    { path: 'organizations', component: OrganizationPageComponent, canMatch: [AuthGuard]},
    { path: '**', component: NotFoundPageComponent}
];

export const appConfig: ApplicationConfig = {
    providers: [
        provideRouter(routes, withRouterConfig({
            onSameUrlNavigation: 'reload'
        })),
        provideHttpClient(),
        provideFirebaseApp(() => initializeApp(environment.FIREBASE)),
        provideAuth(() => getAuth()),
        provideFirestore(() => getFirestore()),
        provideStorage(() => getStorage()),
        provideProtractorTestingSupport(),
        provideAnimationsAsync(),
        providePrimeNG({
            theme: {
                preset: Aura,
                options: {
                    prefix: 'p',
                    darkModeSelector: false,
                    cssLayer: false
                }             
            }
        })
    ]
};