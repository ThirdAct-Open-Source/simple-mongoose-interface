import { Model } from 'mongoose';
import {ClientRequest, IncomingMessage, ServerResponse} from "http";
import { RESTInterfaceHandler } from './RESTInterfaceHandler';

export async function RESTInterfaceMiddlewareInner<T>(modelInterface: RESTInterfaceHandler<T>, req: ClientRequest|IncomingMessage, res: ServerResponse): Promise<void> {
  const msg = ((req instanceof IncomingMessage || Object.getPrototypeOf(req).constructor.name === 'IncomingMessage') ? req : await new Promise<IncomingMessage>((resolve, reject) => {
    res.once('error', (err) => reject(err));
    res.once('response', (clientResp: IncomingMessage) => resolve(clientResp));
  })) as IncomingMessage;

  await modelInterface.execute(msg, res);
}


export function RESTInterfaceMiddlewareHandler<T>(modelInterface: RESTInterfaceHandler<T>, req: ClientRequest, res: ServerResponse, callback: (err: Error|null, ...args: any[]) => void) {
  RESTInterfaceMiddlewareInner(modelInterface, req, res)
    .then((keepGoing)  => {
      callback(null);
    })
    .catch((err) => {
      callback(err);
    });
}

/**
 * Connect middleware for the REST interface
 * @param modelInterface Underlying `RESTInterfaceHandler`
 * @constructor
 */
export function RESTInterfaceMiddleware<T>(modelInterface: RESTInterfaceHandler<T>): typeof RESTInterfaceMiddlewareHandler {
  return RESTInterfaceMiddlewareHandler.bind(void(0), modelInterface);
}


export default RESTInterfaceMiddleware;
