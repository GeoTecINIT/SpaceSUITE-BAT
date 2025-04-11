export class DocumentForm {
  name: string;
  description: string;
  publicFile: boolean;
  organization: {
    _id: string;
    name: string;
  };
  division: string;

  constructor(name?: string, description?: string, publicFile?: boolean, organizationName?: string, organizationId?: string, division?: string) {
    this.name = name ?? '';
    this.description = description ?? '';
    this.publicFile = publicFile ?? false;
    this.organization = {_id: organizationId ?? '', name: organizationName ?? ''};
    this.division = division ?? '';
  }
};