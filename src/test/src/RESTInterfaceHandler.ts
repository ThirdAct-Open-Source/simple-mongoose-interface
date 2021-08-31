import {assert} from 'chai';
import {
  BindRandomSerialize,
  GenerateRandomDefinition,
  GenerateRandomKeyValuePair,
  GenerateRandomMongooseModel, makeChance,
  RandomSchemaInterface,
  RandomSerialize
} from '../common/MongooseGenerator'
import * as _ from 'lodash';
import {Model, Mongoose} from "mongoose";
import {dbClean, dbConnect} from "../common/Mongoose";
import {ModelInterface, ModelInterfaceRequestMethods, SimpleModelInterface} from "../../ModelInterface";
import RESTInterfaceHandler, {HTTPMethodNotAllowedError, OperationToHTTPMethod} from "../../RESTInterfaceHandler";
import fetch from 'node-fetch';
import * as HTTP from "http";
import EncodeTools, {MimeTypesSerializationFormat} from '@etomon/encode-tools/lib/EncodeTools';
import {toPojo} from "@thirdact/to-pojo";

const getPort = require('get-port');
const qs = require('query-string');

describe('RESTInterfaceHandler', async function () {
  let definition: RandomSchemaInterface;
  let model: Model<RandomSchemaInterface>;
  let $modelInterface: ModelInterface<RandomSchemaInterface>;
  let modelInterface: SimpleModelInterface<RandomSchemaInterface>;
  let restInterfaceHandler: RESTInterfaceHandler<RandomSchemaInterface>;
  let mongoose: Mongoose;
  let port: number;
  let baseUrl: string;

  async function clear() {
    this.timeout(5e3);

    await Promise.all([
      (async () => {
        await dbClean();
        mongoose = await dbConnect();
      })(),
      (async () => {
        port = await getPort();
      })()
    ]);

    definition = GenerateRandomDefinition();
    model = GenerateRandomMongooseModel(mongoose, definition);



    baseUrl = `http://127.0.0.1:${port}`;

    $modelInterface = new ModelInterface<RandomSchemaInterface>(model);
    modelInterface = new SimpleModelInterface<RandomSchemaInterface>($modelInterface);
    restInterfaceHandler = new RESTInterfaceHandler<RandomSchemaInterface>(modelInterface, baseUrl);
  }

  after(async function () {
    // await dbClean();
  });

  let srv:  HTTP.Server;
  beforeEach(async function () {
    await clear.call(this);

    srv  = new HTTP.Server()
  })

  type Caddie = {
    req: HTTP.IncomingMessage,
    res:  HTTP.ServerResponse,
    [name:string]: any;
  }

  async function wrapServer(before: (args: { [name: string]: any }) => Promise<void>, after:  (caddie: Caddie) => Promise<void>) {
      (await Promise.all([
        (async () => {
          await new Promise<void>((resolve, reject) => {
            srv.listen(port, () => {
              before.call(this).then(resolve).catch(reject);
            })
          });
        })(),
        new Promise((resolve, reject) => {
          srv.once('request', (req, res) => {
            resolve([req,res]);
          });
          srv.once('error', (err) => {
            reject(err);
          });
        }).then(([req, res]) => after.call(this, {
          req, res
        }))
      ]));
  }

  describe('interfaceRequestFromHttpRequest', async function () {

    let resp: any;
    let body: any;

    beforeEach(async function  () {
      if (!definition)
        await clear.call(this);
    })

    it('should create a query that creates a new record upon POST using JSON as a body', async function () {

      const [k, v] = GenerateRandomKeyValuePair(definition);

      body = {
        fields: {
          [k]: v
        }
      };
      await wrapServer(async () => {
        fetch(baseUrl + '/', BindRandomSerialize({
          method: 'POST'
        }, body)).catch((err) => {});
      }, async ({ req, ers }) => {
        resp = await restInterfaceHandler.interfaceRequestFromHttpRequest(req as HTTP.IncomingMessage);

        assert.ok(resp);
        assert.equal(resp.method, 'create');
        assert.deepEqual(resp.body, body);
      })

    });
    it('should create a query that returns a list of record matching a query on a  random field, with the query as a body', async function () {
      this.timeout(10e3)
      const doc = new model();
      await doc.save();

      const [k] = GenerateRandomKeyValuePair(definition, Object.keys(doc.toJSON()));

      body = {
        query: {
          [k]: doc[k]
        }
      };

      await wrapServer(async () => {
        fetch(baseUrl + `/?${qs.stringify(body.query)}`, BindRandomSerialize({
          method: 'GET'
        })).catch((err) => {});
      }, async ({ req, ers }) => {
        resp = await restInterfaceHandler.interfaceRequestFromHttpRequest(req as HTTP.IncomingMessage);

        assert.ok(resp);
        assert.equal(resp.method, 'find');
        assert.deepEqual(resp.body, body);
      });
    });

    it('should create a query that returns a single record matching a query on a  random field, with the query as a body', async function () {
      this.timeout(10e3)
      const doc = new model();
      await doc.save();

      body = {
        query: {
          query: {
            _id: doc._id.toString()
          }
        }
      };

      await wrapServer(async () => {
        fetch(baseUrl + `/${doc._id}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
          // ,body: JSON.stringify(body)
        }).catch((err) => {});
      }, async ({ req, ers }) => {
        resp = await restInterfaceHandler.interfaceRequestFromHttpRequest(req as HTTP.IncomingMessage);

        assert.ok(resp);
        assert.equal(resp.method, 'findOne');
        assert.deepEqual(resp.body, body);
      });
    });


    it('should create a query that update an existing record', async function () {
      this.timeout(10e3)
      const doc = new model();
      await doc.save();

      const [k,v] = GenerateRandomKeyValuePair(definition, Object.keys(doc.toJSON()));

      body = {
        fields: {
          [k]: v
        }
      };

      await wrapServer(async () => {
        const { buf, mimeType } = RandomSerialize(body);
        fetch(baseUrl + `/${doc._id}`, BindRandomSerialize({
          method: 'PUT'
        }, body)).catch((err) => {});
      }, async ({ req, ers }) => {
        resp = await restInterfaceHandler.interfaceRequestFromHttpRequest(req as HTTP.IncomingMessage);

        assert.ok(resp);
        assert.equal(resp.method, 'update');
        assert.deepEqual(resp.body, {
          ...body,
          query: {
            query: { _id: doc._id.toString() }
          }
        });
      });
    });
    it('should create a query that patches an existing record', async function () {
      this.timeout(10e3)
      const doc = new model();
      await doc.save();

      const [k,v] = GenerateRandomKeyValuePair(definition, Object.keys(doc.toJSON()));

      body = {
        patches:  [
          {
            op: 'replace',
            path: `/${k}`,
            value: v
          }
        ]
      };

      await wrapServer(async () => {
        fetch(baseUrl + `/${doc._id}`, BindRandomSerialize({
          method: 'PATCH'
        }, body)).catch((err) => {});
      }, async ({ req, ers }) => {
        resp = await restInterfaceHandler.interfaceRequestFromHttpRequest(req as HTTP.IncomingMessage);

        assert.ok(resp);
        assert.equal(resp.method, 'patch');
        assert.deepEqual(resp.body, {
          ...body,
          query: {
            query: { _id: doc._id.toString() }
          }
        });
      });
    });
    it('should create a query that deletes an existing record', async function () {
      this.timeout(10e3)
      const doc = new model();
      await doc.save();

      body = {

      };

      await wrapServer(async () => {
        fetch(baseUrl + `/${doc._id}`,BindRandomSerialize( {
          method: 'DELETE'
        })).catch((err) => {});
      }, async ({ req, ers }) => {
        resp = await restInterfaceHandler.interfaceRequestFromHttpRequest(req as HTTP.IncomingMessage);

        assert.ok(resp);
        assert.equal(resp.method, 'delete');
        assert.deepEqual(resp.body, {
          ...body,
          query: {
            query: { _id: doc._id.toString() }
          }
        });
      });
    });
  })
  describe('execute', async function () {
    let resp: any;
    let body: any;

    beforeEach(async function  () {
      if (!definition)
        await clear.call(this);
    })

    it('should create a new record upon POST using JSON as a body', async function () {
      const [k, v] = GenerateRandomKeyValuePair(definition);

      body = {
        fields: {
          [k]: v
        }
      };
      await wrapServer(async () => {
        const resp =  await fetch(baseUrl + '/', BindRandomSerialize({
          method: 'POST'
        },body));
        assert.equal(resp.status, 201);
        assert.ok(resp.headers.get('location'));
        const id = resp.headers.get('location').split('/').pop();
        assert.ok(id);
        const matchingDoc = await model.findById(id);
        assert.ok(matchingDoc);
        assert.equal(matchingDoc[k], body.fields[k]);
      }, async ({ req, res }) => {
        await restInterfaceHandler.execute(req as HTTP.IncomingMessage, res);
      })

    });
    it('should return a list of record matching a query on a  random field, with the query as a body', async function () {
      this.timeout(10e3)
      const doc = new model();
      await doc.save();

      const [k] = GenerateRandomKeyValuePair(definition, Object.keys(doc.toJSON()));

      body = {
        query: {
          [k]: doc[k]
        }
      };

      await wrapServer(async () => {
        const b = BindRandomSerialize({
          method: 'GET'
        });
        const resp = await  fetch(baseUrl + `/?${qs.stringify(body.query)}`, b);
        const mimeType = b.headers['Accept'];
        const format = MimeTypesSerializationFormat.get(mimeType);

        assert.equal(resp.status, 200);
        assert.equal(resp.headers.get('content-type'), mimeType);

        const j = EncodeTools.WithDefaults.deserializeObject<any>(await resp.buffer(), format);
        assert.ok(j);
        assert.equal(j.results.length, 1);
        assert.isNotNull(j.results[0][k])
      }, async ({ req, res }) => {
         await restInterfaceHandler.execute(req as HTTP.IncomingMessage, res);
      });
    });

    it('should return a count of records', async function () {
      this.timeout(10e3);

      const chance = makeChance();
      const count = chance.integer({ min: 0, max: 25 });
      for (let i = 0; i < count; i++) {
        const doc = new model();
        await doc.save();
      }

      await wrapServer(async () => {
        const resp = await  fetch(baseUrl + `/`, BindRandomSerialize({
          method: 'HEAD'
        }));

        assert.equal(resp.status, 200);
        assert.equal(resp.headers.get('x-count'), String(count));
      }, async ({ req, res }) => {
        await restInterfaceHandler.execute(req as HTTP.IncomingMessage, res);
      });
    });

    it('if a single record is returned, and timestamps are enabled, should send timestamp as last modified', async function () {
      // this.timeout(10e3);
      this.timeout(0);

      const doc = new model();
      await doc.save();

      let resp: any;

      await wrapServer(async () => {
        const resp = await  fetch(baseUrl + `/${doc._id.toString()}`, BindRandomSerialize({
          method: 'HEAD'
        }));

        assert.equal(resp.status, 200);
        assert.equal(resp.headers.get('last-modified'), doc.updatedAt.toISOString());
      }, async ({ req, res }) => {
        await restInterfaceHandler.execute(req as HTTP.IncomingMessage, res);
      });
    });

    it('if a single record is returned, and timestamps are enabled, and If-Modified-Since as set, should only return data if the timestamp on the document is ahead of the one provided', async function () {
      this.timeout(10e3);

      const doc = new model();
      await doc.save();
      const chance = makeChance();

      await wrapServer(async () => {
        const resp = await fetch(baseUrl + `/${doc._id.toString()}`, BindRandomSerialize({
          method: 'HEAD',
          headers: {
            'If-Modified-Since': (new Date(chance.date({
              max: doc.updatedAt
            }))).toISOString()
          }
        }));

        assert.equal(resp.status, 304);
      }, async ({ req, res }) => {
        await restInterfaceHandler.execute(req as HTTP.IncomingMessage, res);
      });
    });


    it('should return 404 if no result can be found', async function () {
      this.timeout(10e3);

      await wrapServer(async () => {
        const b = BindRandomSerialize({
          method: 'GET'
        });
        const resp = await fetch(baseUrl + `/${(new (require('mongodb').ObjectId)()).toString()}`, b);
        assert.equal(resp.status, 404);

      }, async ({ req, res }) => {
        await restInterfaceHandler.execute(req as HTTP.IncomingMessage, res);
      });
    });

    it('should return a single record matching a query on a  random field, with the query as a body', async function () {
      this.timeout(10e3)
      const doc = new model();
      await doc.save();

      const [k] = GenerateRandomKeyValuePair(definition, Object.keys(doc.toJSON()));

      body = {
        query: {
          query: { [k]: doc[k] }
        }
      };

      await wrapServer(async () => {
        const b = BindRandomSerialize({
          method: 'GET'
        });
        const resp = await  fetch(baseUrl + `/${doc._id.toString()}`, b);
        const mimeType = b.headers['Accept'];
        const format = MimeTypesSerializationFormat.get(mimeType);

        assert.equal(resp.status, 200);
        assert.equal(resp.headers.get('content-type'), mimeType);

        const j = EncodeTools.WithDefaults.deserializeObject<any>(await resp.buffer(), format);
        assert.ok(j);

        assert.ok(j.result);
        assert.isNotNull(j.result[k])
      }, async ({ req, res }) => {
        await restInterfaceHandler.execute(req as HTTP.IncomingMessage, res);
      });
    });

    it('should reject disallowed operations', async function () {
      this.timeout(10e3);
      const chance = makeChance();
      const [ [method, httpMethod], [method2, httpMethod2] ] = chance.shuffle(
        _.uniq(Array.from(OperationToHTTPMethod.values())).map((k) =>
          chance.shuffle(Array.from(OperationToHTTPMethod.entries())).filter(f => f[1] === k)[0]
        )
      );

      restInterfaceHandler.options = {
        ...restInterfaceHandler.options,
        parseOptions: { allowedMethods: [ method ] }
      };

      await wrapServer(async () => {
        const resp = await  fetch(baseUrl + `/`, BindRandomSerialize({
          method: httpMethod2
        }));

        assert.equal(resp.status, 405);
        assert.equal(resp.headers.get('allow'), httpMethod);
      }, async ({ req, res }) => {
        await restInterfaceHandler.execute(req as HTTP.IncomingMessage, res);
      });
    });

    it('should update an existing record', async function () {
      this.timeout(10e3)
      const doc = new model();
      await doc.save();

      const [k,v] = GenerateRandomKeyValuePair(definition, Object.keys(doc.toJSON()));

      body = {
        fields: {
          [k]: doc[k]
        }
      };

      await wrapServer(async () => {
        const resp = await  fetch(baseUrl + `/${doc._id}`, BindRandomSerialize({
          method: 'PUT'
        }, body));

        assert.equal(resp.status, 204);
      }, async ({ req, res }) => {
        await restInterfaceHandler.execute(req as HTTP.IncomingMessage, res);
      });

      const newDoc = await model.findById(doc._id.toString());

      // console.log(doc._id.toString())
      assert.equal((toPojo(newDoc.toJSON()) as any)[ k ], v);
    });
    it('should patch an existing record', async function () {
      this.timeout(10e3)
      const doc = new model();
      await doc.save();

      const [k,v] = GenerateRandomKeyValuePair(definition, Object.keys(doc.toJSON()));

      body = {
        fields: {
          [k]: doc[k]
        }
      };

      await wrapServer(async () => {
        const resp = await  fetch(baseUrl + `/${doc._id}`, BindRandomSerialize({
          method: 'PATCH'
        }, {
          patches: [
            {
              op: 'replace',
              path: `/${k}`,
              value: v
            }
          ]
        }));

        assert.equal(resp.status, 204);

      }, async ({ req, res }) => {
        await restInterfaceHandler.execute(req as HTTP.IncomingMessage, res);
      });
      const newDoc = await model.findById(doc._id.toString());

      assert.equal((toPojo(newDoc.toJSON()) as any)[ k ], v);
    });
    it('should delete an existing record', async function () {
      this.timeout(10e3)
      const doc = new model();
      await doc.save();

      const [k,v] = GenerateRandomKeyValuePair(definition, Object.keys(doc.toJSON()));

      await wrapServer(async () => {
        const resp = await  fetch(baseUrl + `/${doc._id}`, BindRandomSerialize({
          method: 'DELETE'
        }));

        assert.equal(resp.status, 204);

      }, async ({ req, res }) => {
        await restInterfaceHandler.execute(req as HTTP.IncomingMessage, res);
      });
      const newDoc = await model.findById(doc._id);

      assert.isNull(newDoc);
    });
  });
});
