import {IncomingMessage, ServerResponse} from "http";
import {EncodeToolsAuto, IEncodeTools} from "@etomon/encode-tools";
import * as _ from 'lodash';
import {URL} from 'url';
import {
  IsModelInterfaceError,
  ModelInterfaceError,
  ModelInterfaceRequest,
  ModelInterfaceRequestMethods,
  SimpleModelInterface
} from "./ModelInterface";
import getRawBody from 'raw-body';
import qs, {ParseOptions} from 'query-string';
import {ExtractedSerializationFormatContentType} from "@etomon/encode-tools/lib/IEncodeTools";

export const IsRESTModelInterfaceHandler = Symbol('AmARESTModelInterfaceHandler');

/**
 * Represents an error that will be sent back to the client
 */
export interface HTTPError {
  /**
   * Error message
   */
  message: string;
  /**
   * HTTP Code, defaults to 500
   */
  httpCode?: number;
  /**
   * An optional map of HTTP headers
   */
  headers?: {
    [name: string]: string|string[]|undefined
  }

  isModelInterfaceError: any;
}

export class InvalidHTTPMethodError extends Error implements HTTPError {
  constructor(method: string) {
    super(`Invalid HTTP method ${method}`);
  }

  isModelInterfaceError = IsModelInterfaceError;
}

/**
 * Returned when an interface method not allowed is called from the REST interface
 */
export class HTTPMethodNotAllowedError extends Error implements HTTPError {
  public headers?: { [name: string]: string|undefined; }


  isModelInterfaceError = IsModelInterfaceError;
  /**
   *
   * @param method Not-allowed method that was called
   * @param allowedMethods A list of methods that are allowed, for the "Allow" header
   */
  constructor(method: ModelInterfaceRequestMethods, allowedMethods?: ModelInterfaceRequestMethods[]) {
    super(`HTTP method ${OperationToHTTPMethod.get(method)} now allowed`);

    if (allowedMethods)
      this.headers = { 'Allow': Array.from((new Set(allowedMethods.map(m => OperationToHTTPMethod.get(m))).values())).join(' ') };
  }

  public httpCode = 405;
}

type HTTPMethod = 'GET'|'HEAD'|'POST'|'PUT'|'PATCH'|'DELETE';

/**
 * Map of operations to HTTP methods
 */
export const OperationToHTTPMethod = new Map<ModelInterfaceRequestMethods, HTTPMethod>([
  [ ModelInterfaceRequestMethods.create, 'POST' ],
  [ ModelInterfaceRequestMethods.update, 'PUT' ],
  [ ModelInterfaceRequestMethods.delete, 'DELETE' ],
  [ ModelInterfaceRequestMethods.find, 'GET' ],
  [ ModelInterfaceRequestMethods.findById, 'GET' ],
  [ ModelInterfaceRequestMethods.count, 'HEAD' ],
  [ ModelInterfaceRequestMethods.findOne, 'GET' ],
  [ ModelInterfaceRequestMethods.patch, 'PATCH' ]
]);

export interface RESTInterfaceParserOptions {
  /**
   * If true, will skip parsing the body.
   */
  skipParseBody?: boolean;
  /**
   * Allow upserts when using "PUT"
   */
  upsert?: boolean;
  /**
   * Operations to allow. If `undefined` allows all operations.
   * Denied operations will return a 405 along with the allowed operations in
   * the `Allow` header.
   */
  allowedMethods?: ModelInterfaceRequestMethods[]
  /**
   * Field to return as `Last-Modified` if available
   */
  lastModifiedField?: string;
}

export interface RESTInterfaceHandlerOptions {
  /**
   * Encoder to encode/decode payloads (HTTP body) with.
   * Setting `Accept` (writing) or `Content-Type` (reading) will
   * override the `SerializationFormat` of the encoder, on an
   * `ad-hoc` basis.
   */
  encoder: IEncodeTools;
  /**
   * Options to pass to `raw-body` which is used to turn
   * the HTTP body into a `Buffer`.
   */
  rawBodyOptions: getRawBody.Options;
  /**
   * Options passed to `query-string` which is used
   * to parse query strings.
   *
   * Numbers and booleans are parsed by default
   */
  queryStringOptions: ParseOptions
  /**
   * Options to pass to the parser
   */
  parseOptions?: RESTInterfaceParserOptions
}

/**
 * Default options used to parse query strings
 */
export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
  parseBooleans: true,
  parseNumbers: true
}

/**
 * Defaukt options for the handler
 */
export const DEFAULT_REST_INTERFACE_OPTIONS: RESTInterfaceHandlerOptions = Object.freeze({
  encoder: new EncodeToolsAuto() as IEncodeTools,
  rawBodyOptions: {} as getRawBody.Options,
  queryStringOptions: DEFAULT_PARSE_OPTIONS
});

/**
 * An interface for performing Mongoose CRUD operations over REST
 *
 * GET: / → find
 * GET: /:id → findById
 * PUT: / → update
 * PATCH: / → patch
 * POST: / → create
 * DELETE: / → delete
 */
export class RESTInterfaceHandler<T> {
  /**
   *
   * @param modelInterface The underlying `SimpleModelInterface`
   * @param urlBase Base of the URL endpoint for the model. For example if you'd like `POST`s to `https://example.com/my-model` to run `create` on  `MyModel` set this parameter to `https://example.com/my-model`
   * @param options  Additional options to pass to the REST interface
   */
  constructor(protected modelInterface: SimpleModelInterface<T>, protected urlBase: string, public options: RESTInterfaceHandlerOptions = DEFAULT_REST_INTERFACE_OPTIONS) {

  }


  public static get isRESTModelInterfaceHandler() { return IsRESTModelInterfaceHandler; }
  public get isRESTModelInterfaceHandler() { return RESTInterfaceHandler.isRESTModelInterfaceHandler; }

  /**
   * Underlying `IEncodeTools` instance
   * @protected
   */
  protected get encoder() { return this.options.encoder; }

  /**
   * Parses a URL  using the `urlBase`  as the relative url base
   * @param req HTTP Request
   */
  parseUrl(req: IncomingMessage): URL  {
    return new URL(req.url, this.urlBase);
  }

  /**
   * Extracts a `SerializationFormat` from the specified HTTP header,
   * or defaults to the `SerializationFormat` in the options of the encoder.
   * @param req HTTP Request
   * @param key Name of the header to extract from
   */
  public headerToSerializationFormat(req: IncomingMessage, key: string): ExtractedSerializationFormatContentType {
    return (this.encoder as EncodeToolsAuto).headerToSerializationFormat(req as any, key);
  }

  /**
   * Constructs an interface operation request from a HTTP request
   * @param req HTTP Request
   */
  async interfaceRequestFromHttpRequest(req: IncomingMessage, opts: RESTInterfaceParserOptions = this.options.parseOptions) {
    const parsedUrl = this.parseUrl(req);
    const pathname = parsedUrl.href.replace(this.urlBase, '');
    // First parse the body if we can
    let buf: Buffer|null|undefined = Buffer.isBuffer((req as any).body) ? (req as any).body : null;
    if (!buf) {
      buf = opts?.skipParseBody ? null : await getRawBody(req, this.options.rawBodyOptions);
    }

    if (buf && Buffer.isBuffer(buf) && !buf.length) buf = null;

    const targetId = pathname.substr(1).split('?').shift().split('#').shift();
    const hasPathname = !!(targetId && targetId.length);

    let method: ModelInterfaceRequestMethods|null = (
      // POST, DELETE, PUT, and PATCH map directly to methods
      (req.method === 'POST' && ModelInterfaceRequestMethods.create) ||
      (req.method === 'PUT' && ModelInterfaceRequestMethods.update) ||
      (req.method === 'PATCH' && ModelInterfaceRequestMethods.patch) ||
      (req.method === 'DELETE' && ModelInterfaceRequestMethods.delete) ||
      //  HEAD is count
      (req.method === 'HEAD' && ModelInterfaceRequestMethods.count) ||
      (
        // GET is a special case. If the URL has a pathname value it's findById otherwise find.
        (
          hasPathname ? (
            ModelInterfaceRequestMethods.findOne
          )  : ModelInterfaceRequestMethods.find
        )
      ) || null
    )

    if (!method)
      throw new InvalidHTTPMethodError(req.method);

    if (opts?.allowedMethods && !opts?.allowedMethods.includes(method)) {

      throw new HTTPMethodNotAllowedError(method, opts.allowedMethods);
    }

    let body: any = {  };

    // If a `pathname` is given it becomes the `_id` field.
    if (hasPathname) {
      _.set(body, 'query.query._id', targetId);
      if (method === ModelInterfaceRequestMethods.count) {
        method = ModelInterfaceRequestMethods.findOne;
        _.set(body, 'query.project', { _id: 1, updatedAt: 1 });
      }
    }

    if (buf)
      body = {
      ...this.encoder.deserializeObject<ModelInterfaceRequest<T>>(buf, this.headerToSerializationFormat(req, 'content-type').format),
      ...body
    };

    const q = qs.parse(parsedUrl.search, this.options.queryStringOptions);

    // Override with query string
    for (const key in q) {
      const value = q[key];
      _.set(body, `query.${key}`, value);
    }


    const interfaceRequest: ModelInterfaceRequest<T> = {
      method,
      body
    };

    return interfaceRequest;
  }

  /**
   * Execute an interface operation request based on the parameters constructed from an HTTP Request
   * @param httpReq HTTP Request
   * @param res HTTP Response
   */
  async execute(httpReq: IncomingMessage, res: ServerResponse, opts?: RESTInterfaceParserOptions) {
    // try {
      let req: any;
      let resp: any;
      try {
        req = await this.interfaceRequestFromHttpRequest(httpReq, opts);
      } catch (err) {
        resp = {
          method: (new Map<string, ModelInterfaceRequestMethods>(Array.from(OperationToHTTPMethod.entries()).map(([k, v]) => [v, k]))).get(httpReq.method as HTTPMethod),
          id: null,
          body: {
            error: this.modelInterface.modelInterface.wrapError(err)
          }
        }
      }
      if (!resp)
        resp = await this.modelInterface.execute(req);

      const lastModifiedField = opts?.lastModifiedField || 'updatedAt';
      if ((resp as any).body?.result && (resp as any).body.result[lastModifiedField]) {
        const lastModified: Date | undefined = new Date((resp as any).body.result[lastModifiedField]);
        let modSince: Date | undefined;
        if (httpReq.headers['if-modified-since']) {
          modSince = new Date(httpReq.headers['if-modified-since']);
        }

        if (modSince && lastModified && modSince.getTime() <= lastModified.getTime()) {
          res.statusCode = 304;
          res.end();
          return;
        }

        if (lastModified)
          res.setHeader('Last-Modified', lastModified.toISOString());
      }
      if (typeof (resp.body) === 'undefined' || resp.body === null) {
        res.statusCode = 204;
      } else if ((resp as any).body?.result === null) {
        res.statusCode = 404;
      } else if (resp.method === ModelInterfaceRequestMethods.create && (resp.body as any)?.id) {
        const url = this.parseUrl(httpReq);
        url.pathname += (resp.body as any)?.id;
        res.statusCode = 201;
        res.setHeader('Location', url.href);
      } else {
        const {format: serializationFormat, mimeType} = this.headerToSerializationFormat(httpReq, 'accept');
        res.setHeader('Content-Type', mimeType);

        if (typeof ((resp as any).body?.result) !== 'undefined' && httpReq.method === 'HEAD') {
          res.setHeader('X-Count', (resp as any).body?.result !== null ? 1 : 0);
        } else if (typeof (resp as any).body?.count !== 'undefined') {
          res.setHeader('X-Count', (resp as any).body?.count);
        }

        if (resp.body?.error) {
          const error = (resp.body.error as ModelInterfaceError & HTTPError);
          res.statusCode = error.httpCode || 500;

          if (error.headers) {
            for (let k in error.headers) {
              for (let header of [].concat(error.headers[k] || '')) {
                res.setHeader(k, header);
              }
            }
          }
        } else {
          res.statusCode = 200;
        }

        if (httpReq.method !== 'HEAD') {
          // @ts-ignore
          if (resp.body?.error?.isModelInterfaceError) delete resp.body?.error?.isModelInterfaceError;
          res.write(
            this.encoder.serializeObject(resp.body, serializationFormat)
          )
        }
      }

      res.end();

    // } catch (err) {
    //   throw err;
    // }
  }
}

export default RESTInterfaceHandler;
