import { Server } from "multi-rpc-core";
import {
  DEFAULT_SIMPLE_MODEL_INTERFACE_OPTIONS,
  SimpleModelInterface
} from "./ModelInterface";

/**
 * Exposes the `SimpleModelInterface` as a `multi-rpc` RPC interface
 *
 * The methods of the `SimpleModelInterface` will be exposed as `ModelName:method`
 * So the find operation on a model named "Bar" would be `Bar:find`.
 */
export class RPCInterface<T> {
  /**
   *
   * @param modelInterface The underlying model interface
   * @param rpcServer The `multi-rpc` server instance
   * @param methodPrefix A prefix to assign all keys, so a prefix "Foo:", a model "Bar" and the find method would be `Foo:Bar:find`
   */
  constructor(protected modelInterface: SimpleModelInterface<T>, protected rpcServer: Server, protected methodPrefix?: string) {
    for (let k of Object.getOwnPropertyNames((modelInterface as any).__proto__)) {
      if (k === 'constructor' || k === 'execute') continue;
      this.rpcServer.methods[`${this.rpcInterfaceMethodPrefix}${k}`] = (modelInterface as any)[k].bind(modelInterface);
    }
  }

  public get rpcInterfaceMethodPrefix(): string {
    return `${this.methodPrefix ? this.methodPrefix :  ''}${this.modelInterface.modelInterface.name}:`;
  }
}

export default RPCInterface;
