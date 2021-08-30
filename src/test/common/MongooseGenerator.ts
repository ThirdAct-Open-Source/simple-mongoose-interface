import {Model, ObjectId, Document, Schema, Mongoose} from 'mongoose';
import {Chance} from 'chance';
import _ from 'lodash';
import {ModelInterfaceError,IsModelInterfaceError} from "../../ModelInterface";
import EncodeTools, {SerializationFormat, SerializationFormatMimeTypes} from "@etomon/encode-tools/lib/EncodeTools";
import {EncodeToolsAuto} from "@etomon/encode-tools";
import { RequestInfo, Request } from 'node-fetch';

const chance = makeChance();

export interface RandomSchemaInterface {
  [name: string]: any;
}

export function makeChance() {
  return new Chance();
}

function RandomValue(type: unknown, def: unknown[], required: boolean = false) {
  return {
    type,
    default: () => _.sample(def),
    required
  }
}

function RandomNumber(required: boolean = false) {
  return RandomValue(Number, [
    chance.integer(), chance.floating()
  ], required)
}

function RandomString(required: boolean = false) {
  return RandomValue(String, [
     chance.string(), chance.paragraph(), chance.sentence()
  ], required)
}

function RandomBool(required: boolean = false) {
  return RandomValue(Boolean, [
   true, false
  ], required)
}

export function GenerateStandardError() {
  return new Error(chance.string());
}

export function GenerateRandomModelInterfaceError(): ModelInterfaceError {
  return  {
    message: chance.string(),
    httpCode: chance.bool() ? chance.integer({
      min: 400,
      max: 599
    }) : void(0),
    innerError: _.sample([
      GenerateStandardError(),
      void(0)
    ]),
    stack: chance.bool() ? chance.string() : void(0),
    isModelInterfaceError: IsModelInterfaceError
  }
}

export function GenerateRandomDefinition(): RandomSchemaInterface {
  const definition: RandomSchemaInterface = {};

  for (let i = 0; i < chance.integer({ min: 1, max: 25 }); i++) {
    definition[chance.string({
      symbols: false,
      numeric: true,
      alpha: true
    }).replace(/[$]/g, '_')] = chance.bool() ?  (
      RandomString()
    ) : (
      chance.bool() ? (
        RandomNumber()
      ) : RandomBool()
    )
  }

  return definition;
}

export function GenerateRandomMongooseSchema(definition?: RandomSchemaInterface): Schema<RandomSchemaInterface> {
  return new Schema<RandomSchemaInterface>(definition || GenerateRandomDefinition());
}

export function GenerateRandomMongooseModel(mongoose: Mongoose, definition?: RandomSchemaInterface): Model<RandomSchemaInterface> {
  const name = chance.string({ symbols: false, numeric: false, alpha: true }).replace(/\$/ig, '_');
  return mongoose.model<any, any>(name, GenerateRandomMongooseSchema(definition));
}

export async function GenerateStructures(model: Model<RandomSchemaInterface>, num?: number): Promise<Document<RandomSchemaInterface>[]> {
  const docs: Document<RandomSchemaInterface>[] = [];
  for (let i = 0; i < (num ? num : chance.integer({ min: 1, max: 25 })); i++) {
    const doc = new model();
    docs.push(doc);
    // await new Promise<void>((resolve, reject) => {
    //   setTimeout(() => resolve(), 250);
    // });
  }
  return docs;
}

export function GenerateRandomKeyValuePairs(definition: RandomSchemaInterface, keyRestriction?: string[]): [ string, unknown ][] {
  keyRestriction = keyRestriction || Object.keys(definition);
  const chance = makeChance();

  const randomFields = chance.shuffle(
    Object.keys(definition)
      .filter((k) => keyRestriction.includes(k) && (definition as any)[k] && (definition as any)[k].default)
  ).map((k) => [ k, (definition as any)[k].default() ]) as [string,unknown][];

  return randomFields;
}

export function GenerateRandomKeyValuePair(definition: RandomSchemaInterface, keyRestriction?: string[]): [ string, unknown ] {
  return _.sample(GenerateRandomKeyValuePairs(definition, keyRestriction));
}

export function RandomSerializationFormat(): { format: SerializationFormat, mimeType: string } {
  const [ format, mimeType ] = _.sample(Array.from(SerializationFormatMimeTypes.entries()));
  return { format, mimeType };
}

export function RandomSerialize(obj: any): { format: SerializationFormat, mimeType: string, buf: Buffer } {
  const { format, mimeType } = RandomSerializationFormat();
  const buf = EncodeTools.WithDefaults.serializeObject(obj, format);
  return {
    buf,
    format,
    mimeType
  }
}

export function BindRandomSerialize(fetchObj: any, obj?: any): any {
  fetchObj.headers = fetchObj.headers || {};
  if (obj) {
    const {mimeType, buf} = RandomSerialize(obj);
    fetchObj.body = Buffer.from(buf);
    fetchObj.headers['Content-Type'] = fetchObj.headers['Accept'] = mimeType;
  } else {
    const { mimeType } = RandomSerializationFormat();
    fetchObj.headers['Accept'] = mimeType;
  }

  return fetchObj;
}

