import { Component, Input, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InputIconModule } from "primeng/inputicon";
import { IconFieldModule } from "primeng/iconfield";
import { InputTextModule } from "primeng/inputtext";
import { FloatLabelModule } from "primeng/floatlabel";
import { TextareaModule } from 'primeng/textarea';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SelectModule } from 'primeng/select';
import { BehaviorSubject, Subscription, take } from 'rxjs';
import { DocumentForm } from '../../model/documentForm';
import { UserInformationService } from '../../services/userInformation.service';

@Component({
  standalone: true,
  selector: 'app-document-information',
  imports: [CommonModule, FormsModule, InputIconModule, IconFieldModule, InputTextModule, FloatLabelModule, TextareaModule, SelectButtonModule, SelectModule],
  templateUrl: './document-information.component.html',
  styleUrl: './document-information.component.css',
})
export class DocumentInformationComponent {

  @Input() isPdfAvailable: boolean = false;
  @Input() logged: boolean = false;
  @Input() formData: DocumentForm = new DocumentForm();
  @Output() formDataChange = new BehaviorSubject<DocumentForm>(this.formData);
  
  stateOptions: any[] = [{ label: 'Public', value: true },{ label: 'Private', value: false }];

  organizations: {_id: string, name: string}[] = [];
  selectedOrganization: {_id: string, name: string} | null = null;

  organizationDivisions: Map<string, string[]> = new Map();
  selectedDivision: string | null = null;

  private userInfoSubscription!: Subscription;

  constructor(private userInfoService: UserInformationService) {}

  ngOnInit() {
    this.selectedOrganization = (this.formData?.organization._id == '' && this.formData?.organization.name == '') ? null : this.formData?.organization!;
    this.selectedDivision = this.formData?.division ?? null;

    this.userInfoSubscription = this.userInfoService.getUserOrganizationList().subscribe(orgs => {
      this.organizations = orgs;
      this.organizationDivisions = new Map();
      this.organizations.forEach( org => {
        this.userInfoService.getOrganizationDivisions(org._id).pipe(take(1)).subscribe(divisions => {
          this.organizationDivisions.set(org._id, divisions);
        })
      })
    })
  }

  ngOnDestroy(): void {
    this.userInfoSubscription.unsubscribe();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['formData'] && !changes['formData'].isFirstChange()) {
      this.selectedOrganization = (this.formData?.organization._id == '' && this.formData?.organization.name == '') ? null : this.formData?.organization;
      this.selectedDivision = this.formData?.division ?? null;
    }
  }

  updateDocumentForm() {
    this.formData.organization = this.selectedOrganization ?? {_id: '', name: ''};
    this.formData.division = this.selectedDivision ?? '';
    this.formDataChange.next(this.formData);
  }

  getValidationMessage(): string | null {
    if (!this.logged) return 'Login to save the document';
    if (!this.isPdfAvailable) return 'Upload a file to save the document';
    if (this.selectedOrganization == null) return 'Select an Organization to save the document';
    if (this.selectedDivision == '' || this.selectedDivision == null) return 'Select a Division to save the document';
    return null;
  }
}
