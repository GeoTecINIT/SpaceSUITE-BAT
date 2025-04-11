import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnnotateDocumentComponent } from './annotate-document.component';

describe('AnnotateDocumentComponent', () => {
  let component: AnnotateDocumentComponent;
  let fixture: ComponentFixture<AnnotateDocumentComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnnotateDocumentComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AnnotateDocumentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
