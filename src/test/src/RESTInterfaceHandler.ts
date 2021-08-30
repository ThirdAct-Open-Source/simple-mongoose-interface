import {assert} from 'chai';
import {
  BindRandomSerialize,
  GenerateRandomDefinition, GenerateRandomKeyValuePair,
  GenerateRandomMongooseModel,
  RandomSchemaInterface, RandomSerializationFormat, RandomSerialize
} from '../common/MongooseGenerator'
import {Model, Mongoose, Schema,Document} from "mongoose";
import {dbClean, dbConnect} from "../common/Mongoose";
import {
  ModelInterface,
  ModelInterfaceRequest,
  ModelInterfaceResponse,
  SimpleModelInterface
} from "../../ModelInterface";
import RESTInterfaceHandler from "../../RESTInterfaceHandler";
import fetch from 'node-fetch';

import getPort from 'get-port';
import * as HTTP from "http";
import * as _ from "lodash";
import {IncomingMessage} from "http";
import qs from 'querystring';
import EncodeTools, { MimeTypesSerializationFormat } from '@etomon/encode-tools/lib/EncodeTools';

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
    await dbClean();
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

  async function wrapServer(before: (args: { resolve: () => void, reject: (err: Error) => void, [name: string]: any }) => Promise<void>, after:  (caddie: Caddie) => Promise<void>) {
      const [[req, res]] = (await Promise.all([
        new Promise((resolve, reject) => {
          srv.once('request', (req, res) => {
            resolve([req,res]);
          });
          srv.once('error', (err) => {
            reject(err);
          });
        }),
        (async () => {
          await new Promise<void>((resolve, reject) => {
            srv.listen(port, () => {
              resolve();
            })

            before.call(this, { resolve, reject });
          });
        })()
      ])) as [HTTP.IncomingMessage, HTTP.ServerResponse][];
      await after.call(this, {
        req, res
      });
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
      await wrapServer(async ({  resolve, reject }) => {
        fetch(baseUrl + '/', BindRandomSerialize({
          method: 'POST'
        }, body)).catch((err) => reject(err));
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

      await wrapServer(async ({  resolve, reject }) => {
        fetch(baseUrl + `/?${qs.stringify(body.query)}`, BindRandomSerialize({
          method: 'GET'
        })).catch((err) => reject(err));
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
          _id: doc._id.toString()
        }
      };

      await wrapServer(async ({  resolve, reject }) => {
        fetch(baseUrl + `/${doc._id}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
          // ,body: JSON.stringify(body)
        }).catch((err) => reject(err));
      }, async ({ req, ers }) => {
        resp = await restInterfaceHandler.interfaceRequestFromHttpRequest(req as HTTP.IncomingMessage);

        assert.ok(resp);
        assert.equal(resp.method, 'findById');
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

      await wrapServer(async ({  resolve, reject }) => {
        const { buf, mimeType } = RandomSerialize(body);
        fetch(baseUrl + `/${doc._id}`, BindRandomSerialize({
          method: 'PUT'
        }, body)).catch((err) => reject(err));
      }, async ({ req, ers }) => {
        resp = await restInterfaceHandler.interfaceRequestFromHttpRequest(req as HTTP.IncomingMessage);

        assert.ok(resp);
        assert.equal(resp.method, 'update');
        assert.deepEqual(resp.body, {
          ...body,
          query: {
            _id: doc._id.toString()
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

      await wrapServer(async ({  resolve, reject }) => {
        fetch(baseUrl + `/${doc._id}`, BindRandomSerialize({
          method: 'PATCH'
        }, body)).catch((err) => reject(err));
      }, async ({ req, ers }) => {
        resp = await restInterfaceHandler.interfaceRequestFromHttpRequest(req as HTTP.IncomingMessage);

        assert.ok(resp);
        assert.equal(resp.method, 'patch');
        assert.deepEqual(resp.body, {
          ...body,
          query: {
            _id: doc._id.toString()
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

      await wrapServer(async ({  resolve, reject }) => {
        fetch(baseUrl + `/${doc._id}`,BindRandomSerialize( {
          method: 'DELETE'
        })).catch((err) => reject(err));
      }, async ({ req, ers }) => {
        resp = await restInterfaceHandler.interfaceRequestFromHttpRequest(req as HTTP.IncomingMessage);

        assert.ok(resp);
        assert.equal(resp.method, 'delete');
        assert.deepEqual(resp.body, {
          ...body,
          query: {
            _id: doc._id.toString()
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
      await wrapServer(async ({  resolve, reject }) => {
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

      await wrapServer(async ({  resolve, reject }) => {
        const b = BindRandomSerialize({
          method: 'GET'
        });
        const resp = await  fetch(baseUrl + `/?${qs.stringify(body.query)}`, b);
        const mimeType = b.headers['Accept'];
        const format = MimeTypesSerializationFormat.get(b.headers[mimeType]);

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

    it('should return a single record matching a query on a  random field, with the query as a body', async function () {
      this.timeout(10e3)
      const doc = new model();
      await doc.save();

      const [k] = GenerateRandomKeyValuePair(definition, Object.keys(doc.toJSON()));

      body = {
        query: {
          [k]: doc[k]
        }
      };

      await wrapServer(async ({  resolve, reject }) => {
        const b = BindRandomSerialize({
          method: 'GET'
        });
        const resp = await  fetch(baseUrl + `/${doc._id}`, b);
        const mimeType = b.headers['Accept'];
        const format = MimeTypesSerializationFormat.get(b.headers[mimeType]);

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

      await wrapServer(async ({  resolve, reject }) => {
        const resp = await  fetch(baseUrl + `/${doc._id}`, BindRandomSerialize({
          method: 'PUT'
        }, body));

        assert.equal(resp.status, 204);
        const newDoc = await model.findById(doc._id);

        assert.equal( newDoc.toJSON()[ k ], v);
      }, async ({ req, res }) => {
        await restInterfaceHandler.execute(req as HTTP.IncomingMessage, res);
      });
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

      await wrapServer(async ({  resolve, reject }) => {
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
        const newDoc = await model.findById(doc._id);

        assert.equal( newDoc.toJSON()[ k ], v);
      }, async ({ req, res }) => {
        await restInterfaceHandler.execute(req as HTTP.IncomingMessage, res);
      });
    });
    it('should delete an existing record', async function () {
      this.timeout(10e3)
      const doc = new model();
      await doc.save();

      const [k,v] = GenerateRandomKeyValuePair(definition, Object.keys(doc.toJSON()));

      await wrapServer(async ({  resolve, reject }) => {
        const resp = await  fetch(baseUrl + `/${doc._id}`, BindRandomSerialize({
          method: 'DELETE'
        }));

        assert.equal(resp.status, 204);
        const newDoc = await model.findById(doc._id);

        assert.isNull(newDoc);
      }, async ({ req, res }) => {
        await restInterfaceHandler.execute(req as HTTP.IncomingMessage, res);
      });
    });
  });
});
