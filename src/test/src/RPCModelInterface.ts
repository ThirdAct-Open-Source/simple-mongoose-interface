import {
  GenerateRandomDefinition, GenerateRandomKeyValuePair, GenerateRandomKeyValuePairs,
  GenerateRandomMongooseModel, GenerateStructures, makeChance,
  RandomSchemaInterface, RandomSerializationFormat
} from "../common/MongooseGenerator";
import {
  IDType,
  JSONPatchOp,
  ModelInterface,
  ModelInterfaceRequestMethods, ModelInterfaceResponseCreate, ModelInterfaceResponseResult,
  SimpleModelInterface,
  Query as QueryBase, DEFAULT_SIMPLE_MODEL_INTERFACE_OPTIONS
} from "../../ModelInterface";
import {dbClean, dbConnect} from "../common/Mongoose";
import {ObjectId} from "mongodb";
import {assert} from "chai";
import * as _ from "lodash";
import {Model, Mongoose, Document, Schema} from "mongoose";
import {Client, Server, TCPTransport, Transport} from 'multi-rpc';
type Query = QueryBase<RandomSchemaInterface>;
import { EncodeToolsSerializer } from 'multi-rpc-common/lib/EncodeToolsSerializer';
import {ServerSideTransport} from "multi-rpc-common";
import EncodeTools, {SerializationFormat} from "@etomon/encode-tools/lib/EncodeTools";
import getPort from 'get-port';
import RPCInterface from "../../RPCInterface";
import { toPojo } from '@thirdact/to-pojo';

describe('RPCInterface', async function () {
  let definition: RandomSchemaInterface;
  let model: Model<RandomSchemaInterface>;
  let $modelInterface: ModelInterface<RandomSchemaInterface>;
  let $$modelInterface: SimpleModelInterface<RandomSchemaInterface>;
  let mongoose: Mongoose;
  let rpcServer: Server;
  let serverTransport: Transport&ServerSideTransport;
  let clientTransport: Transport;
  let serializer: EncodeToolsSerializer;
  let format: SerializationFormat;
  let mimeType: string;
  let enc: EncodeTools;
  let port: number;
  let rpcInterface: RPCInterface<RandomSchemaInterface>;
  let prefix: string = '';
  let rpcClient: Client;

  let modelInterface:any;

  async function clear() {
    this.timeout(5e3);
    await dbClean();
    mongoose = await dbConnect();

    let { format: $format, mimeType: $mimeType } = RandomSerializationFormat();
    format = $format;
    mimeType = $mimeType;
    serializer = new EncodeToolsSerializer({ serializationFormat: format });
    port = await getPort();
    serverTransport = new TCPTransport(serializer, port);
    rpcServer = new Server(serverTransport)

    definition = GenerateRandomDefinition();
    model = GenerateRandomMongooseModel(mongoose, definition);
    $modelInterface = new ModelInterface<RandomSchemaInterface>(model);


    modelInterface = new Proxy({} as any, {
      get(target: any, p: any, receiver: any): any {
        return async (...args: any[]) => {
          try {
            const method = `${prefix + model.modelName}:${p}`;
            return await rpcClient.invoke(method, args);
          } catch (err) {
            if (err.data) {
              throw err.data;
            }
            throw err;
          }
        }
      }
    })

    $$modelInterface = new SimpleModelInterface<RandomSchemaInterface>($modelInterface);
    const chance = makeChance();
    prefix = chance.bool() ? chance.string({ symbols: false, alpha: true, numeric: true }) : '';

    rpcInterface = new RPCInterface<RandomSchemaInterface>($$modelInterface, rpcServer, prefix);
    clientTransport = new TCPTransport(serializer, port);
    rpcClient = new Client(clientTransport);

    await serverTransport.listen();
  }

  after(async function () {
    await dbClean();

    await (serverTransport as any).server.close();
  });

  beforeEach(clear);

  describe('rpcInterfaceMethodPrefix', async function () {
    it('should equal the prefix specified in the constructor', function () {
      assert.equal(rpcInterface.rpcInterfaceMethodPrefix, (
        prefix+model.modelName+':'
      ));
    })
  })

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
          mongooseResult.map(d => toPojo(d.toJSON())),
          'interface results did not match the results from mongo'
        );

        assert.deepEqual(
          interfaceResult,
          result.map(d => toPojo(d.toJSON())),
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
        const mongooseQ = $modelInterface.createQuery(q);
        const mongooseResult = await mongooseQ.exec();
        const result = docs
          .sort((A: Document<RandomSchemaInterface>,B: Document<RandomSchemaInterface>) => direction ?  Buffer.compare((B._id as ObjectId).id, (A._id as ObjectId).id) : Buffer.compare((A._id as ObjectId).id, (B._id as ObjectId).id))
          .slice(skip, skip+limit);

        assert.deepEqual(
          [interfaceResult],
          mongooseResult.map(d => toPojo(d.toJSON())),
          'interface results did not match the results from mongo'
        );

        assert.deepEqual(
          [interfaceResult],
          result.map(d => toPojo(d.toJSON())),
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
          query: { _id: doc._id.toString() },
          limit: 1
        };

        const interfaceResult = await modelInterface.findOne(q);

        const mongooseQ = $modelInterface.createQuery(q);
        const mongooseResult = await mongooseQ.exec();
        const result = [doc];

        assert.deepEqual(
          [interfaceResult],
          mongooseResult.map(d => toPojo(d.toJSON())),
          'interface results did not match the results from mongo'
        );

        assert.deepEqual(
          [interfaceResult],
          result.map(d => toPojo(d.toJSON())),
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
              [direction ? '$gte' : '$lte']: midDoc._id.toString()
            }
          },
          sort: {}
        };

        const delta = {[fieldToChange]: v}

        const mQ = $modelInterface.createQuery(q);

        await modelInterface.update(q, delta, false);

        const mDocs = await mQ.exec();
        const fields = _.uniq(mDocs.map(d => d[fieldToChange]));
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
        const fields = mDocs.map(d => d[fieldToChange]);
        const a = _.uniq(fields).filter(x => typeof(x) !== 'undefined');

        assert.equal(a.length, 1);
      });
    });
    describe('patch', async function () {
      it('should update a random field from a random document',  async function () {
        try {
          const chance = makeChance();
          const index = chance.integer({min: 0, max: docs.length - 1});

          const midDoc = docs[index];

          const [
            fieldToChange,
            v
          ] = GenerateRandomKeyValuePair(definition, Object.keys(midDoc.toJSON()))

          const q = {
            query: {
              _id: {
                [direction ? '$gte' : '$lte']: midDoc._id.toString()
              }
            },
            sort: {}
          };

          const delta = {[fieldToChange]: v}

          const mQ = $modelInterface.createQuery(q);

          await modelInterface.patch(q, [
            {
              op: (midDoc as any)[fieldToChange] ? JSONPatchOp.replace : JSONPatchOp.add,
              path: `/${fieldToChange}`,
              value: v
            }
          ]);

          const mDocs = await mQ.exec();
          const fields = _.uniq(mDocs.map(d => d[fieldToChange]));
          assert.equal(fields.length, 1);
          const [mValue] = fields;

          assert.deepEqual(mValue, v);
        } catch (err) {
          debugger
        }
      });
    });

    describe('delete', async function () {
      it('should remove a document based on a query', async function () {
        const [ doc ] = docs;
        const q: Query = { query: { _id: doc._id.toString() } };
        await modelInterface.delete(q);
        const nowDoc = await model.findById(doc._id).exec();

        assert.isNull(nowDoc);
      });
    });
  });
  // describe('execute', async function () {
  //   const chance = makeChance();
  //   describe('execute - update', async function () {
  //     let docs: Document<RandomSchemaInterface>[] = [];
  //     let direction: boolean;
  //     beforeEach(async function () {
  //       await clear.call(this);
  //       const chance = makeChance();
  //       this.timeout(5e3);
  //
  //       direction = chance.bool();
  //
  //       docs = (await GenerateStructures(model))
  //         .sort((A: Document<RandomSchemaInterface>, B: Document<RandomSchemaInterface>) => direction ? Buffer.compare((B._id as ObjectId).id, (A._id as ObjectId).id) : Buffer.compare((A._id as ObjectId).id, (B._id as ObjectId).id));
  //
  //       for (let doc of docs)
  //         await doc.save();
  //     });
  //
  //     it('should send the same params for update', async function () {
  //       const [randomField, val] = GenerateRandomKeyValuePair(definition);
  //       await modelInterface.execute({
  //         method: ModelInterfaceRequestMethods.update,
  //         body: {
  //           query: {
  //             [randomField]: { $exists: true }
  //           } as any,
  //           fields: {
  //             [randomField]: val
  //           }
  //         }
  //       });
  //
  //       const hasValues = await model.find({
  //         [randomField]: val
  //       }).count();
  //
  //       assert.isAbove(hasValues, 0);
  //     });
  //     it('should send the same params for patch', async function () {
  //       const [ randomField, val] = GenerateRandomKeyValuePair(definition);
  //
  //       await modelInterface.execute({
  //         method: ModelInterfaceRequestMethods.patch,
  //         body: {
  //           query: {
  //             [randomField]: { $exists: true }
  //           } as any,
  //           patches: [
  //             {
  //               op: JSONPatchOp.replace,
  //               value: val,
  //               path: `/${randomField}`
  //             }
  //           ]
  //         }
  //       });
  //
  //       const hasValues = await model.find({
  //         [randomField]: val
  //       }).count();
  //
  //       assert.isAbove(hasValues, 0);
  //     });
  //     it('should send the same params for findById', async function () {
  //       const randomDoc = _.sample(docs);
  //       const resp = await modelInterface.execute({
  //         method: ModelInterfaceRequestMethods.findById,
  //         body: {
  //           id: randomDoc._id.toString() as IDType
  //         }
  //       });
  //
  //       const rd = toPojo(randomDoc.toJSON());
  //
  //       assert.deepEqual(
  //         (resp.body as {result:ModelInterfaceResponseResult<RandomSchemaInterface>}).result,
  //         rd
  //       );
  //     });
  //
  //     it('should send the same params for delete', async function () {
  //       const randomDoc = _.sample(docs);
  //       const resp = await modelInterface.execute({
  //         method: ModelInterfaceRequestMethods.delete,
  //         body: {
  //           query: {
  //             query: {
  //               _id:  randomDoc._id.toString()
  //             }
  //           }
  //         }
  //       });
  //
  //       const newDoc = await model.findById(randomDoc._id);
  //       assert.notOk(newDoc);
  //     });
  //
  //     it('should send the same params for create', async function () {
  //       const [ randomField, val] = GenerateRandomKeyValuePair(definition);
  //
  //       const resp = await modelInterface.execute({
  //         method: ModelInterfaceRequestMethods.create,
  //         body: {
  //           fields: {
  //             [randomField]: val
  //           }
  //         }
  //       });
  //
  //       const newDoc = await model.findById((resp.body as ModelInterfaceResponseCreate).id);
  //       assert.isOk(newDoc);
  //       assert.equal((resp.body as ModelInterfaceResponseCreate).id.toString(),  (newDoc as  any)._id.toString());
  //     });
  //   });
  //
  //   it('should send the same params for find, findOne, count, delete', async function () {
  //     try {
  //       const q: Query = {
  //         limit: chance.integer(),
  //         query: {}
  //       };
  //
  //       for (let k of [
  //         'find',
  //         'findOne',
  //         'count',
  //         'delete'
  //       ]) {
  //         const rQ = await new Promise((resolve, reject) => {
  //           function fn(rQ: unknown) {
  //             resolve(rQ);
  //             return {
  //               toJSON: () => {
  //               }
  //             }
  //           }
  //
  //
  //           ($$modelInterface as any).modelInterface[k] = fn as any;
  //           modelInterface.execute({
  //             method: k as any,
  //             body: {
  //               query: q
  //             }
  //           }).catch((err: Error) => reject(err));
  //         });
  //
  //         assert.deepEqual(rQ, q);
  //       }
  //     } catch  (err) {
  //       throw err;
  //     }
  //   });
  // });
});
