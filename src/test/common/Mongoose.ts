require('dotenv').config();
const mongoose = require('mongoose');
import { MongoClient } from 'mongodb';
import {URL} from 'url';

export async function dbClean() {
  const mongoUri = new URL(process.env.MONGO_URI);
  const mongo = await MongoClient.connect(mongoUri.href);

  await mongo.db(mongoUri.pathname.substr(1)).dropDatabase();
  return mongo.close();
}

export async function dbConnect() {
  const mongoUri = new URL(process.env.MONGO_URI);

  return mongoose.connect(
    mongoUri.href,
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useFindAndModify: true,
      useCreateIndex: true
    }
  );
}
