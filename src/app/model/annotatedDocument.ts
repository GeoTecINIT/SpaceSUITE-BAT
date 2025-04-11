export class AnnotatedDocument extends Object {
    constructor(
      public _id: string,
      public url: string,
      public userId: string,
      public orgId: string,
      public orgName: string,
      public collection: string,
      public collectionDisplay: string,
      public isPublic: boolean = false,
      public name: string,
      public title: string,
      public description: string,
      public concepts: any[],
      public type: number,
      public updatedAt: any,
      public createdAt: any,
      public division: string
    ) {
      super();
    }

    toPlainObject() {
      return {
        _id: this._id,
        url: this.url,
        userId: this.userId,
        orgId: this.orgId,
        orgName: this.orgName,
        collection: this.collection,
        collectionDisplay: this.collectionDisplay,
        isPublic: this.isPublic,
        name: this.name,
        title: this.title,
        description: this.description,
        concepts: this.concepts,
        type: this.type,
        updatedAt: this.updatedAt,
        createdAt: this.createdAt,
        division: this.division,
      };
    }
      
  }