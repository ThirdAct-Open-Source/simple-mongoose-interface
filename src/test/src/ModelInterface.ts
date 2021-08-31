import {assert} from 'chai';
import {
  GenerateRandomDefinition, GenerateRandomKeyValuePair, GenerateRandomKeyValuePairs,
  GenerateRandomModelInterfaceError,
  GenerateRandomMongooseModel,
  GenerateStandardError,
  GenerateStructures,
  makeChance,
  RandomSchemaInterface
} from '../common/MongooseGenerator'
import {Document, Model, Mongoose} from "mongoose";
import {dbClean, dbConnect} from "../common/Mongoose";

import { toPojo } from '@thirdact/to-pojo';
import {
  FindByIdModelInterfaceRequestBody,
  IDType,
  IsModelInterfaceError,
  JSONPatchOp,
  ModelInterface,
  ModelInterfaceRequestMethods, ModelInterfaceResponseCreate, ModelInterfaceResponseResult,
  Query as QueryBase,
  SimpleModelInterface
} from "../../ModelInterface";
import {ObjectId} from 'mongodb';
import * as _ from 'lodash';

type Query = QueryBase<RandomSchemaInterface>;

describe('ModelInterface', async function () {
  let definition: RandomSchemaInterface;
  let model: Model<RandomSchemaInterface>;
  let modelInterface: ModelInterface<RandomSchemaInterface>;
  let mongoose: Mongoose;

  this.timeout(0);

  async function clear() {
    this.timeout(5e3);
    await dbClean();
    mongoose = await dbConnect();

    definition = GenerateRandomDefinition();
    model = GenerateRandomMongooseModel(mongoose, definition);
    modelInterface = new ModelInterface<RandomSchemaInterface>(model);
  }

  after(async function () {
    await dbClean();
  });

  beforeEach(clear);

  describe('get name()', async function () {
    it('name in the interface should be the same as the name in the Mongoose model', async function () {
      assert.equal(modelInterface.name, model.modelName);
    });
  });

  describe('wrapError()', async function () {
    it('should return the error object unchanged, if a ModelInterfaceError is provided', async function () {
      const error1 = GenerateRandomModelInterfaceError();
      const error2 = modelInterface.wrapError(error1);

      assert.deepEqual(error2, error1, 'Errors were not the same');
    });

    it('should contain the standard error as the inner error', async function () {
      const origError = GenerateStandardError();
      const wrappedError = modelInterface.wrapError(origError);

      assert.deepEqual(wrappedError.innerError, origError);
    });

    it('should return an object with the `isModelInterfaceError` field set to `IsModelInterfaceError`', async function () {
      const origError = GenerateStandardError();
      const wrappedError = modelInterface.wrapError(origError);

      assert.equal(wrappedError.isModelInterfaceError, IsModelInterfaceError);
    });
  });

  describe('create()', async function ()  {
    it('should create a document based on the provided fields', async  function () {
      const id = new ObjectId();
      const randomDoc = (new model({
        _id: id
      }));

      await modelInterface.create((randomDoc as any)._doc);
      const doc = await model.findById(id);

      assert.deepEqual(doc._id, id);
    })
  });

  describe('ModelInterface.toPojo()', async function () {
    it('should return the `toJSON` version of a document', async function () {
      const doc = new model({
        _id: new ObjectId()
      });
      assert.deepEqual(ModelInterface.toPojo(doc), toPojo(doc.toJSON()));
    });
    it('should return the `toJSON` version of all documents in an array', async function () {
      const chance = makeChance();

      const docs = Array.from(new Array(chance.integer({ min: 1, max: 25 })))
        .map((d) => new model({
          _id: new ObjectId()
        }));

      const pojoDocs = docs.map((d) => toPojo(d.toJSON()));

      assert.deepEqual(ModelInterface.toPojo(docs), pojoDocs);
    });

    it('should return the `toJSON` version of a document with virtuals', async function () {
      const doc = new model({
        _id: new ObjectId()
      });

      const compDoc: any =  toPojo(doc.toJSON());
      compDoc.id = doc._id.toString();
      let dd: any = ModelInterface.toPojo(doc);
      dd.id = dd._id;
      assert.deepEqual(dd, compDoc);
    });

    it('should use `toObject` if `toJSON` is not available', async function () {
      let success = Symbol('success');
      const doc = {
        foo: 'bar',
        toObject() {
          return success;
        }
      }
      assert.equal(ModelInterface.toPojo(doc as any) as any, success);
    });


    it('should use `cloneDeep` if neither `toJSON` or `toObject` is available', async function () {

      const doc = {
        foo: 'bar'
      }
      assert.deepEqual(ModelInterface.toPojo(doc as any) as any, {
        foo: 'bar'
      });
    });
  });

  describe('createQuery', async function () {
    let query:  Query;

    beforeEach(async function () {
      await clear.call(this);
      const chance = makeChance();
      let baseParams = chance.shuffle(Object.keys(definition));
      let params = baseParams.slice(
        1,
        chance.integer({ min: 0, max: baseParams.length-1 })
      );

      let sortParams = chance.shuffle(baseParams).slice(
        1,
        chance.integer({ min: 0, max: baseParams.length-1 })
      );

      const subQuery: { [name: string]: any } = {};
      const sortQuery: { [name: string]: any } = {};

      for (const key of params) {
        subQuery[key] = { $exists: true };
      }

      for (const key of sortParams) {
        sortQuery[key] = chance.bool() ? 1 : -1;
      }

      query = {
        sort: sortQuery,
        query: subQuery,
        limit: chance.integer({ min: 1, max: 25 }),
        skip: chance.integer({ min: 0, max: 25 }),
        populate: baseParams.slice(0, chance.integer({ min: 0, max: baseParams.length-1 })).join(' ')
      }
    })

    it('conditions of the Mongoose Query should be the same as the conditions in the Interface Query', async function () {
      const q = modelInterface.createQuery(query);

      assert.deepEqual((q as any)._conditions, query.query);
    });

    it('sort doc of the Mongoose Query should be the same as the sort doc in the Interface Query', async function () {
      const q = modelInterface.createQuery(query);

      assert.deepEqual((q as any).options?.sort || {}, query.sort);
    });

    it('skip of the Mongoose Query should be the same as the skip in the Interface Query', async function () {
      const q = modelInterface.createQuery(query);

      assert.equal((q as any).options.skip, query.skip);
    });

    it('limit of the Mongoose Query should be the same as the limit in the Interface Query', async function () {
      const q = modelInterface.createQuery(query);

      assert.equal((q as any).options.limit, query.limit);
    });

    it('populate of the Mongoose Query should be the same as the populate in the Interface Query', async function () {
      const q = modelInterface.createQuery(query);

      assert.deepEqual(Object.keys(q. _mongooseOptions.populate || {}).filter(f => f && f.length), query.populate.split(' ').filter(f => f && f.length));
    });
  });

  describe('find functions', async function () {
    let docs: Document<RandomSchemaInterface>[] = [];
    beforeEach(async function () {
      await clear.call(this);
      this.timeout(5e3);
      docs = await GenerateStructures(model);

      for (let doc of docs)
        await doc.save();
    });
    describe('find', async function () {
      it('should return an array with results matching query params in the same order', async function () {
        const chance = makeChance();
        let direction = chance.bool();
        let limit = chance.integer({ min: 1, max: docs.length });
        let skip = chance.integer({ min: 0, max: docs.length - 1 })
        const q: Query = {
          sort: { _id: direction ? -1 : 1 },
          query: {},
          limit,
          skip
        };

        const result = docs
          .sort((A: Document<RandomSchemaInterface>,B: Document<RandomSchemaInterface>) => direction ?  Buffer.compare((B._id as ObjectId).id, (A._id as ObjectId).id) : Buffer.compare((A._id as ObjectId).id, (B._id as ObjectId).id))
          .slice(skip, skip+limit);

        const interfaceResult = await modelInterface.find(q);

        const mongooseQ = modelInterface.createQuery(q);
        const mongooseResult = await mongooseQ.exec();

        assert.deepEqual(
          interfaceResult.map((d) =>toPojo(d.toJSON())),
          [].concat(mongooseResult).map((d: any) =>toPojo(d.toJSON())),
          'interface results did not match the results from mongo'
        );

        assert.deepEqual(
          interfaceResult.map((d) =>toPojo(d.toJSON())),
          result.map((d: any) =>toPojo(d.toJSON())),
          'query results did not match the results from the interface'
        );
      });
    });
    describe('findOne', async function () {
      it('should return an array with results matching query params in the same order', async function () {
        const chance = makeChance();
        let direction = chance.bool();
        let limit = chance.integer({ min: 1, max: docs.length });
        let skip = chance.integer({ min: 0, max: docs.length - 1 })
        const q: Query = {
          sort: { _id: direction ? -1 : 1 },
          query: {},
          skip
        };

        q.limit = limit = 1;

        const interfaceResult = await modelInterface.findOne(q);
        const mongooseQ = modelInterface.createQuery(q);
        const mongooseResult = await mongooseQ.exec();
        const result = docs
          .sort((A: Document<RandomSchemaInterface>,B: Document<RandomSchemaInterface>) => direction ?  Buffer.compare((B._id as ObjectId).id, (A._id as ObjectId).id) : Buffer.compare((A._id as ObjectId).id, (B._id as ObjectId).id))
          .slice(skip, skip+limit);

        assert.deepEqual(
          [interfaceResult].map((d) =>toPojo(d.toJSON())),
          [].concat(mongooseResult).map((d: any) =>toPojo(d.toJSON())),
          'interface results did not match the results from mongo'
        );

        assert.deepEqual(
          [interfaceResult].map((d) =>toPojo(d.toJSON())),
          result.map((d: any) =>toPojo(d.toJSON())),
          'query results did not match the results from the interface'
        );
      });
    });
    describe('findById', async function () {
      it('should return an array with results matching query params in the same order', async function () {
        const chance = makeChance();
        let direction = chance.bool();
        let limit = chance.integer({ min: 1, max: docs.length });
        let skip = chance.integer({ min: 0, max: docs.length - 1 });
        const doc = _.sample(docs);
        const q: Query = {
          query: { _id: doc._id },
          limit: 1
        };

        const interfaceResult = await modelInterface.findOne(q);

        const mongooseQ = modelInterface.createQuery(q);
        const mongooseResult = await mongooseQ.exec();
        const result = [doc];

        assert.deepEqual(
          [interfaceResult].map((d) =>toPojo(d.toJSON())),
          [].concat(mongooseResult).map((d: any) =>toPojo(d.toJSON())),
          'interface results did not match the results from mongo'
        );

        assert.deepEqual(
          [interfaceResult].map((d) =>toPojo(d.toJSON())),
          result.map((d: any) =>toPojo(d.toJSON())),
          'query results did not match the results from the interface'
        );
      });
    });
    describe('count', async function () {
      it('should return an array with results matching query params in the same order', async function () {
        const chance = makeChance();
        let direction = chance.bool();
        let limit = chance.integer({ min: 1, max: docs.length });
        let skip = chance.integer({ min: 0, max: docs.length - 1 })
        const q: Query = {
          sort: { _id: direction ? -1 : 1 },
          query: {},
          limit,
          skip
        };

        const interfaceResult = await modelInterface.count(q);

        const mongooseQ = modelInterface.createQuery(q);
        const mongooseResult = await mongooseQ.count();
        const result = docs
          .slice(skip, skip+limit)
          .length;

        assert.equal(
          interfaceResult,
          mongooseResult,
          'interface results did not match the results from mongo'
        );

        assert.equal(
          interfaceResult,
          result,
          'query results did not match the results from the interface'
        );
      });
    });
  });
  describe('update/delete queries',   async function () {
    let docs: Document<RandomSchemaInterface>[] = [];
    let direction: boolean;

    beforeEach(async function () {
      await clear.call(this);
      const chance = makeChance();
      this.timeout(5e3);

      direction = chance.bool();

      docs = (await GenerateStructures(model))
        .sort((A: Document<RandomSchemaInterface>, B: Document<RandomSchemaInterface>) => direction ? Buffer.compare((B._id as ObjectId).id, (A._id as ObjectId).id) : Buffer.compare((A._id as ObjectId).id, (B._id as ObjectId).id));

      for (let doc of docs)
        await doc.save();
    });

    describe('update', async function () {
      it('should update a random field from a random document',  async function () {
        const chance = makeChance();
        const index = chance.integer({min: 0, max: docs.length-1});

        const midDoc = docs[index];

        const [ fieldToChange, v ] = GenerateRandomKeyValuePair(definition, Object.keys(midDoc.toJSON()));
        const q = {
          query: {
            _id: {
              [direction ? '$gte' : '$lte']: midDoc._id
            }
          },
          sort: {}
        };

        const delta = {[fieldToChange]: v}

        const mQ = modelInterface.createQuery(q);

        await modelInterface.update(q, delta, false);

        const mDocs = await mQ.exec();
        const fields = _.uniq([].concat(mDocs).map((d: any) => d[fieldToChange]));
        assert.equal(fields.length, 1);
        const [mValue] = fields;

        assert.deepEqual(mValue, v);
      });
      it('should create a new document from the parameters if one does not exist',  async function () {
        const [[fieldToChange,v1], [fieldToQuery,v2]] = GenerateRandomKeyValuePairs(definition);

        const q = {
          query: {
            [fieldToQuery]: v2
          },
          sort: {}
        };

        const delta = {[fieldToChange]: v1}

        await modelInterface.update(
          q,
          delta,
          true
        );
        const mQ = modelInterface.createQuery(q);

        await modelInterface.update(q, delta, false);

        const mDocs = await mQ.exec();
        const fields = [].concat(mDocs).map((d: any) => d[fieldToChange]);
        const a = _.uniq(fields).filter(x => typeof(x) !== 'undefined');

        assert.equal(a.length, 1);
      });
    });
    describe('patch', async function () {
      it('should update a random field from a random document',  async function () {
        const chance = makeChance();
        const index = chance.integer({min: 0, max: docs.length-1});

        const midDoc = docs[index];

        const [fieldToChange,v] = GenerateRandomKeyValuePair(definition, Object.keys(midDoc.toJSON()));

        const q = {
          query: {
            _id: {
              [direction ? '$gte' : '$lte']: midDoc._id
            }
          },
          sort: {}
        };

        const delta = {[fieldToChange]: v}

        const mQ = modelInterface.createQuery(q);

        await modelInterface.patch(q, [
          {
            op: (midDoc as any)[fieldToChange] ? JSONPatchOp.replace :  JSONPatchOp.add,
            path:  `/${fieldToChange}`,
            value: v
          }
        ]);

        const mDocs = await mQ.exec();
        const fields = _.uniq([].concat(mDocs).map((d: any) => d[fieldToChange]));
        assert.equal(fields.length, 1);
        const [mValue] = fields;

        assert.deepEqual(mValue, v);
      });
    });

    describe('delete', async function () {
      it('should remove a document based on a query', async function () {
        const [ doc ] = docs;
        const q: Query = { query: { _id: doc._id } };
        await modelInterface.delete(q);
        const nowDoc = await model.findById(doc._id).exec();

        assert.isNull(nowDoc);
      });
    });
  });
});

describe('SimpleModelInterface', async function () {
  let definition: RandomSchemaInterface;
  let model: Model<RandomSchemaInterface>;
  let $modelInterface: ModelInterface<RandomSchemaInterface>;
  let modelInterface: SimpleModelInterface<RandomSchemaInterface>;
  let mongoose: Mongoose;

  async function clear() {
    this.timeout(5e3);
    await dbClean();
    mongoose = await dbConnect();

    definition = GenerateRandomDefinition();
    model = GenerateRandomMongooseModel(mongoose, definition);
    $modelInterface = new ModelInterface<RandomSchemaInterface>(model);
    modelInterface = new SimpleModelInterface<RandomSchemaInterface>($modelInterface);
  }

  after(async function () {
    await dbClean();
  });

  beforeEach(clear);

  describe('find functions', async function () {
    let docs: Document<RandomSchemaInterface>[] = [];
    beforeEach(async function () {
      await clear.call(this);
      this.timeout(5e3);
      docs = await GenerateStructures(model);

      for (let doc of docs)
        await doc.save();
    });
    describe('find', async function () {
      it('should return an array with results matching query params in the same order', async function () {
        const chance = makeChance();
        let direction = chance.bool();
        let limit = chance.integer({ min: 1, max: docs.length });
        let skip = chance.integer({ min: 0, max: docs.length - 1 })
        const q: Query = {
          sort: { _id: direction ? -1 : 1 },
          query: {},
          limit,
          skip
        };

        const result = docs
          .sort((A: Document<RandomSchemaInterface>,B: Document<RandomSchemaInterface>) => direction ?  Buffer.compare((B._id as ObjectId).id, (A._id as ObjectId).id) : Buffer.compare((A._id as ObjectId).id, (B._id as ObjectId).id))
          .slice(skip, skip+limit);

        const interfaceResult = await modelInterface.find(q);

        const mongooseQ = $modelInterface.createQuery(q);
        const mongooseResult = await mongooseQ.exec();

        assert.deepEqual(
          interfaceResult,
          [].concat(mongooseResult).map((d: any) =>toPojo(d.toJSON())),
          'interface results did not match the results from mongo'
        );

        assert.deepEqual(
          interfaceResult,
          result.map((d: any) =>toPojo(d.toJSON())),
          'query results did not match the results from the interface'
        );
      });
    });
    describe('findOne', async function () {
      it('should return an array with results matching query params in the same order', async function () {
        const chance = makeChance();
        let direction = chance.bool();
        let limit = chance.integer({ min: 1, max: docs.length });
        let skip = chance.integer({ min: 0, max: docs.length - 1 })
        const q: Query = {
          sort: { _id: direction ? -1 : 1 },
          query: {},
          skip
        };

        q.limit = 1;

        const interfaceResult = await modelInterface.findOne(q);
        const mongooseQ = $modelInterface.createQuery(q);
        const mongooseResult = await mongooseQ.exec();
        const result = docs
          .sort((A: Document<RandomSchemaInterface>,B: Document<RandomSchemaInterface>) => direction ?  Buffer.compare((B._id as ObjectId).id, (A._id as ObjectId).id) : Buffer.compare((A._id as ObjectId).id, (B._id as ObjectId).id))
          .slice(skip, 1);

        assert.deepEqual(
          [interfaceResult],
          [].concat(mongooseResult).map((d: any) =>toPojo(d.toJSON())),
          'interface results did not match the results from mongo'
        );

        // assert.deepEqual(
        //   [interfaceResult],
        //   result.map((d: any) =>toPojo(d.toJSON())),
        //   'query results did not match the results from the interface'
        // );
      });
    });
    describe('findById', async function () {
      it('should return an array with results matching query params in the same order', async function () {
        const chance = makeChance();
        let direction = chance.bool();
        let limit = chance.integer({ min: 1, max: docs.length });
        let skip = chance.integer({ min: 0, max: docs.length - 1 });
        const doc = _.sample(docs);
        const q: Query = {
          query: { _id: doc._id },
          limit: 1
        };

        const interfaceResult = await modelInterface.findOne(q);

        const mongooseQ = $modelInterface.createQuery(q);
        const mongooseResult = await mongooseQ.exec();
        const result = [doc];

        assert.deepEqual(
          [interfaceResult],
          [].concat(mongooseResult).map((d: any) =>toPojo(d.toJSON())),
          'interface results did not match the results from mongo'
        );

        assert.deepEqual(
          [interfaceResult],
          result.map((d: any) =>toPojo(d.toJSON())),
          'query results did not match the results from the interface'
        );
      });
    });
    describe('count', async function () {
      it('should return an array with results matching query params in the same order', async function () {
        const chance = makeChance();
        let direction = chance.bool();
        let limit = chance.integer({ min: 1, max: docs.length });
        let skip = chance.integer({ min: 0, max: docs.length - 1 })
        const q: Query = {
          sort: { _id: direction ? -1 : 1 },
          query: {},
          limit,
          skip
        };

        const interfaceResult = await modelInterface.count(q);

        const mongooseQ = $modelInterface.createQuery(q);
        const mongooseResult = await mongooseQ.count();
        const result = docs
          .slice(skip, skip+limit)
          .length;

        assert.equal(
          interfaceResult,
          mongooseResult,
          'interface results did not match the results from mongo'
        );

        assert.equal(
          interfaceResult,
          result,
          'query results did not match the results from the interface'
        );
      });
    });
  });
  describe('update/delete queries',   async function () {
    let docs: Document<RandomSchemaInterface>[] = [];
    let direction: boolean;

    beforeEach(async function () {
      await clear.call(this);
      const chance = makeChance();
      this.timeout(5e3);

      direction = chance.bool();

      docs = (await GenerateStructures(model))
        .sort((A: Document<RandomSchemaInterface>, B: Document<RandomSchemaInterface>) => direction ? Buffer.compare((B._id as ObjectId).id, (A._id as ObjectId).id) : Buffer.compare((A._id as ObjectId).id, (B._id as ObjectId).id));

      for (let doc of docs)
        await doc.save();
    });

    describe('update', async function () {
      it('should update a random field from a random document',  async function () {
        const chance = makeChance();
        const index = chance.integer({min: 0, max: docs.length-1});

        const midDoc = docs[index];

        const [fieldToChange,v] = GenerateRandomKeyValuePair(definition, Object.keys(midDoc.toJSON()));

        const q = {
          query: {
            _id: {
              [direction ? '$gte' : '$lte']: midDoc._id
            }
          },
          sort: {}
        };

        const delta = {[fieldToChange]: v}

        const mQ = $modelInterface.createQuery(q);

        await modelInterface.update(q, delta, false);

        const mDocs = await mQ.exec();
        const fields = _.uniq([].concat(mDocs).map((d: any) => d[fieldToChange]));
        assert.equal(fields.length, 1);
        const [mValue] = fields;

        assert.deepEqual(mValue, v);
      });
      it('should create a new document from the parameters if one does not exist',  async function () {
        const chance = makeChance();

        const [
          [fieldToChange,v1],
          [fieldToQuery,v2]
        ] = GenerateRandomKeyValuePairs(definition);

        const q = {
          query: {
            [fieldToQuery]: v2
          },
          sort: {}
        };

        const delta = {[fieldToChange]: v1}

        await modelInterface.update(
          q,
          delta,
          true
        );
        const mQ = $modelInterface.createQuery(q);

        await modelInterface.update(q, delta, false);

        const mDocs = await mQ.exec();
        const fields = [].concat(mDocs).map((d: any) => d[fieldToChange]);
        const a = _.uniq(fields).filter(x => typeof(x) !== 'undefined');

        assert.equal(a.length, 1);
      });
    });
    describe('patch', async function () {
      it('should update a random field from a random document',  async function () {
        const chance = makeChance();
        const index = chance.integer({min: 0, max: docs.length-1});

        const midDoc = docs[index];

        const [
          fieldToChange,
          v
        ]  = GenerateRandomKeyValuePair(definition, Object.keys(midDoc.toJSON()))

        const q = {
          query: {
            _id: {
              [direction ? '$gte' : '$lte']: midDoc._id
            }
          },
          sort: {}
        };

        const delta = {[fieldToChange]: v}

        const mQ = $modelInterface.createQuery(q);

        await modelInterface.patch(q, [
          {
            op: (midDoc as any)[fieldToChange] ? JSONPatchOp.replace :  JSONPatchOp.add,
            path:  `/${fieldToChange}`,
            value: v
          }
        ]);

        const mDocs = await mQ.exec();
        const fields = _.uniq([].concat(mDocs).map((d: any) => d[fieldToChange]));
        assert.equal(fields.length, 1);
        const [mValue] = fields;

        assert.deepEqual(mValue, v);
      });
    });

    describe('delete', async function () {
      it('should remove a document based on a query', async function () {
        const [ doc ] = docs;
        const q: Query = { query: { _id: doc._id } };
        await modelInterface.delete(q);
        const nowDoc = await model.findById(doc._id).exec();

        assert.isNull(nowDoc);
      });
    });
  });

  describe('execute', async function () {
    const chance = makeChance();
    it('should send the same params for find, findOne, count, delete', async function () {
      try {
        const q: Query = {
          limit: chance.integer(),
          query: {}
        };

        for (let k of [
          'find',
          'findOne',
          'count',
          'delete'
        ]) {
          const rQ = await new Promise((resolve, reject) => {
            function fn(rQ: unknown) {
              resolve(rQ);
              return {
                toJSON: () => {
                }
              }
            }


            (modelInterface as any).modelInterface[k] = fn as any;
            modelInterface.execute.call(modelInterface,{
              method: k as any,
              body: {
                query: q
              }
            }).catch((err: Error) => reject(err));
          });

          assert.deepEqual(rQ, q);
        }
      } catch  (err) {
        throw err;
      }
    });
    describe('execute - update', async function () {
      let docs: Document<RandomSchemaInterface>[] = [];
      let direction: boolean;
      beforeEach(async function () {
        await clear.call(this);
        const chance = makeChance();
        this.timeout(5e3);

        direction = chance.bool();

        docs = (await GenerateStructures(model))
          .sort((A: Document<RandomSchemaInterface>, B: Document<RandomSchemaInterface>) => direction ? Buffer.compare((B._id as ObjectId).id, (A._id as ObjectId).id) : Buffer.compare((A._id as ObjectId).id, (B._id as ObjectId).id));

        for (let doc of docs)
          await doc.save();
      });

      it('should send the same params for update', async function () {
        const [randomField, val] = GenerateRandomKeyValuePair(definition);
        await modelInterface.execute({
          method: ModelInterfaceRequestMethods.update,
          body: {
            query: {
              [randomField]: { $exists: true }
            } as any,
            fields: {
              [randomField]: val
            }
          }
        });

        const hasValues = await model.find({
          [randomField]: val
        }).count();

        assert.isAbove(hasValues, 0);
      });
      it('should send the same params for patch', async function () {
        const [ randomField, val] = GenerateRandomKeyValuePair(definition);

        await modelInterface.execute({
          method: ModelInterfaceRequestMethods.patch,
          body: {
            query: {
              [randomField]: { $exists: true }
            } as any,
            patches: [
              {
                op: JSONPatchOp.replace,
                value: val,
                path: `/${randomField}`
              }
            ]
          }
        });

        const hasValues = await model.find({
          [randomField]: val
        }).count();

        assert.isAbove(hasValues, 0);
      });
      it('should send the same params for findById', async function () {
        const randomDoc = _.sample(docs);
        const resp = await modelInterface.execute({
          method: ModelInterfaceRequestMethods.findById,
          body: {
            id: randomDoc._id as IDType
          }
        });

        assert.deepEqual(
          (resp.body as {result:ModelInterfaceResponseResult<RandomSchemaInterface>}).result,
          toPojo(randomDoc.toJSON())
        );
      });

      it('should send the same params for delete', async function () {
        const randomDoc = _.sample(docs);
        const resp = await modelInterface.execute({
          method: ModelInterfaceRequestMethods.delete,
          body: {
            query: {
              query: {
                _id:  randomDoc._id
              }
            }
          }
        });

        const newDoc = await model.findById(randomDoc._id);
        assert.notOk(newDoc);
      });

      it('should send the same params for create', async function () {
        const [ randomField, val] = GenerateRandomKeyValuePair(definition);

        const resp = await modelInterface.execute({
          method: ModelInterfaceRequestMethods.create,
          body: {
            fields: {
              [randomField]: val
            }
          }
        });

        const newDoc = await model.findById((resp.body as ModelInterfaceResponseCreate).id);
        assert.isOk(newDoc);
        assert.equal((resp.body as ModelInterfaceResponseCreate).id.toString(),  (newDoc as  any)._id.toString());
      });
    });
  });

});
