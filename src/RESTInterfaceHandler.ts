import {ClientRequest, IncomingMessage, ServerResponse} from "http";
import {EncodeToolsAuto, IEncodeTools} from "@etomon/encode-tools";
import {SerializationFormat, SerializationFormatMimeTypes, MimeTypesSerializationFormat} from "@etomon/encode-tools/lib/EncodeTools";
import * as _ from 'lodash';
import { URL } from 'url';
import {
  ModelInterfaceError,
  ModelInterfaceRequest,
  ModelInterfaceRequestMethods,
  SimpleModelInterface
} from "./ModelInterface";
import getRawBody from 'raw-body';
import qs, {ParseOptions} from 'query-string';
import {ExtractedSerializationFormatContentType} from "@etomon/encode-tools/lib/IEncodeTools";

export class InvalidHTTPMethodError extends Error {
  constructor(method: string) {
    super(`Invalid HTTP method ${method}`);
  }
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
}

/**
 * Default options used to parse query strings
 */
export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
  parseBooleans: true,
  parseNumbers: true
}

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
  constructor(protected modelInterface: SimpleModelInterface<T>, protected urlBase: string, protected options: RESTInterfaceHandlerOptions = {
    encoder: new EncodeToolsAuto() as IEncodeTools,
    rawBodyOptions: {} as getRawBody.Options,
    queryStringOptions: DEFAULT_PARSE_OPTIONS
  }) { }

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
  async interfaceRequestFromHttpRequest(req: IncomingMessage) {
    const parsedUrl = this.parseUrl(req);
    // First parse the body if we can
    let buf: Buffer|null|undefined;
    buf = await getRawBody(req, this.options.rawBodyOptions);
    if (!buf.length) {
      buf = null;
    }
    const targetId = parsedUrl.pathname.substr(1);
    const hasPathname = !!(targetId && targetId.length);

    const method: ModelInterfaceRequestMethods|null = (
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
            ModelInterfaceRequestMethods.findById
          )  : ModelInterfaceRequestMethods.find
        )
      ) || null
    )

    if (!method)
      throw new InvalidHTTPMethodError(req.method);

    let body: any = {};

    // If a `pathname` is given it becomes the `_id` field.
    if (hasPathname)
      _.set(body, 'query._id', targetId);

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
  async execute(httpReq: IncomingMessage, res: ServerResponse) {
      const req = await this.interfaceRequestFromHttpRequest(httpReq);
      const resp = await this.modelInterface.execute(req);
      if (typeof(resp.body) === 'undefined' || resp.body === null) {
        res.statusCode = 204;
      }
      else if (resp.method === ModelInterfaceRequestMethods.create && (resp.body as any)?.id){
        const url = this.parseUrl(httpReq);
        url.pathname += (resp.body as any)?.id;
        res.statusCode = 201;
        res.setHeader('Location', url.href);
      }
      else {
        const { format: serializationFormat, mimeType } = this.headerToSerializationFormat(httpReq, 'accept');
        res.setHeader('Content-Type', mimeType);
        if (resp.body?.error) {
          const error = (resp.body.error as ModelInterfaceError);
          res.statusCode = error.httpCode || 500;
        } else {
          res.statusCode = 200;
        }
        res.write(
          this.encoder.serializeObject(resp.body, serializationFormat)
        )
      }

      res.end();
  }
}

export default RESTInterfaceHandler;
