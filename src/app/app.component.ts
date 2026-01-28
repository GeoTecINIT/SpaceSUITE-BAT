import { Component } from '@angular/core';
import { HeaderComponent, FooterComponent } from '@eo4geo/ngx-bok-utils';
import { MenuItem } from 'primeng/api';
import { Router, RouterOutlet } from '@angular/router';
import { ReleaseNotesComponent } from './components/releaseNotes/releaseNotes.component';
import { PdfService } from './services/pdf.service';

@Component({
  standalone: true,
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  imports: [RouterOutlet, HeaderComponent, FooterComponent, ReleaseNotesComponent],
})
export class AppComponent {
  releaseNotes: boolean = false;

  headerItems: MenuItem[] = [
    {
      label: 'Tools',
      icon: 'pi pi-cog',
      items: [
        {
          label: 'BoK Visualization & Search',
          icon: 'pi pi-search',
          url: 'https://bok.eo4geo.eu',
          target: '_blank'
        },
        {
          label: 'Occupational Profile Tool',
          icon: 'pi pi-users',
          url: 'https://eo4geo-opt.web.app',
          target: '_blank'
        },
        {
          label: 'Job Offer Tool',
          icon: 'pi pi-book',
          url: 'https://eo4geo-jot.web.app',
          target: '_blank'
        },
        {
          label: 'Curriculum Design Tool',
          icon: 'pi pi-sitemap',
          url: 'https://eo4geo-cdt.web.app',
          target: '_blank'
        },
        {
          label: 'Training Catalogue',
          icon: 'pi pi-graduation-cap',
          url: 'https://spacesuite-project-tct.web.app/',
          target: '_blank'
        },
        {
          label: 'Skill Portfolio',
          icon: 'pi pi-user',
          url: 'https://spacesuite-project-spt.web.app',
          target: '_blank'
        },
        {
          label: 'BoK Annotation Tool',
          icon: 'pi pi-pencil',
          style: {'--p-tieredmenu-item-color': 'var(--hover-color)'},
          iconStyle: {'color': 'var(--hover-color)'}
        },
        {
          label: 'BoK Matching Tool',
          icon: 'pi pi-equals',
          url: 'https://eo4geo-bmt.web.app',
          target: '_blank'
        }
      ]
    }, 
    {
      label: 'Share',
      icon: 'pi pi-share-alt',
      items: [
        {
          label: 'X',
          icon: 'pi pi-twitter',
          url: 'https://twitter.com/SpaceSUITE_eu',
          target: '_blank'
        },
        {
          label: 'Facebook',
          icon: 'pi pi-facebook',
          url: 'https://www.facebook.com/spacesuiteproject/',
          target: '_blank'
        },
        {
          label: 'Youtube',
          icon: 'pi pi-youtube',
          url: 'https://www.youtube.com/@SpaceSUITE_eu',
          target: '_blank'
        },
        {
          label: 'LinkedIn',
          icon: 'pi pi-linkedin',
          url: 'https://www.linkedin.com/showcase/spacesuite_eu/',
          target: '_blank'
        }
      ]
    }
  ];

  constructor(private router: Router, private pdfService: PdfService) {}

  redirectToProfile() {
    this.router.navigate(['profile']);
  }

  redirectToOrganizations() {
    this.router.navigate(['organizations']);
  }

  openPdf() {
    this.pdfService.getPdf().subscribe(pdfBlob => {
      const pdfUrl = URL.createObjectURL(pdfBlob);
      window.open(pdfUrl, '_blank');
    });
  }
}
